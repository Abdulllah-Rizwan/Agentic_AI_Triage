// Hand-written agent loop for the mobile app.
// Does NOT use Google ADK — ADK requires a Python runtime which is unavailable offline.
// All LLM calls go through NetworkOrchestrator.getLLMAdapter() — never directly.

import { networkOrchestrator } from '../services/network/NetworkOrchestrator';
import { queryKnowledgeBase } from '../services/rag/LocalRAG';
import { queryGuidance } from '../services/rag/queryGuidance';
import {
  detectCriticalSymptom,
  type MedicalFeatureVector,
} from '../services/triage/TriageEngine';
import type { ChatMessage as LLMChatMessage } from '../services/llm/LLMAdapter.interface';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentStatus = 'COLLECTING' | 'SUFFICIENT' | 'CRITICAL';

export interface AgentSerializableState {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  turnCount: number;
  criticalMode: boolean;
  criticalTrigger: string | null;
  postCriticalTurns: number;
}

export interface AgentResponse {
  message: string;
  status: AgentStatus;
  criticalTrigger?: string;
  ragContext?: string;
  featureVector?: MedicalFeatureVector;
}

type HistoryEntry = { role: 'user' | 'assistant'; content: string };

// ── System prompt — DO NOT PARAPHRASE (CLAUDE.md) ────────────────────────────

const SYSTEM_PROMPT = `You are a compassionate first-response triage assistant deployed in a disaster zone. Your ONLY job is to collect patient symptoms clearly and systematically.

Rules you MUST follow:
1. Ask ONE question at a time. Never ask two questions.
2. Use simple language. No medical jargon.
3. Be empathetic but efficient.
4. Do NOT diagnose. Do NOT prescribe. Do NOT name medications.
5. Collect in this order if not already provided:
   - Chief complaint (what is the main problem?)
   - Onset (when did it start?)
   - Severity (rate pain/discomfort 1-10)
   - Associated symptoms (anything else wrong?)
   - Allergies (any known drug allergies?)

When you have: chief complaint, onset, severity score, at least 2 associated symptoms or confirmation there are none, and allergy status — you have enough information.

Signal completion by responding ONLY with this exact JSON (nothing else, no text before or after):
{"status":"SUFFICIENT","chief_complaint":"<concise medical chief complaint in 3-8 words, e.g. 'Severe chest pain with shortness of breath'>","summary":"<2 sentence clinical summary of the patient's condition>"}

If the patient mentions ANY of these critical symptoms, respond ONLY with this exact JSON immediately:
chest pain, difficulty breathing, cannot breathe, uncontrolled bleeding, unconscious, seizure, crush injury, snake bite, stroke, severe burn, choking, amputation, electric shock:
{"status":"CRITICAL","trigger":"<the symptom mentioned>","message":"<one sentence of immediate safety advice>"}

Never break character. Never say you are an AI.
Introduce yourself as: "I am your medical assessment assistant."`;

// Used when a critical symptom has been detected — replaces SYSTEM_PROMPT so
// the LLM gathers comprehensive clinical detail before emitting CRITICAL JSON.
// After MAX_POST_CRITICAL_TURNS we force-emit CRITICAL regardless.
const CRITICAL_MODE_SYSTEM_PROMPT = `You are an emergency medical assistant. A potentially life-threatening symptom has been reported: {symptom}.

Your task is to gather thorough clinical information before completing the assessment. Medical responders NEED this detail to treat the patient quickly and effectively. Ask ONE question at a time.

You must collect ALL five of the following data points — but SKIP any that the patient has already answered earlier in this conversation:
1. LOCATION — Exactly where is the problem? Which part of the body? (e.g. "Where exactly are you bleeding from?", "Which side is the chest pain on?")
2. SEVERITY — How severe is it on a scale of 1 to 10?
3. ONSET — How did it start? Was there an injury, accident, or did it come on suddenly by itself?
4. PROGRESSION — Is it getting better, worse, or staying the same? (For bleeding: is it heavy and uncontrolled, or slow and manageable?)
5. ASSOCIATED SYMPTOMS — Are you experiencing anything else — dizziness, weakness, difficulty breathing, nausea, severe pain elsewhere?

Rules you MUST follow:
- Ask ONLY ONE question per response. Be calm, brief, and compassionate.
- Read the full conversation history above carefully. Do NOT re-ask anything already answered.
- Do NOT diagnose. Do NOT name any medications.
- Only after you have collected answers for ALL five points above, respond ONLY with this exact JSON and absolutely nothing else before or after it:
{"status":"CRITICAL","trigger":"{symptom}","message":"<one brief, calm safety instruction appropriate to the symptom — e.g. apply firm pressure to the wound, sit down and stay calm, do not eat or drink anything, help is on the way>"}
- You MUST ask all five questions. There are NO exceptions. Even if the situation sounds severe, gathering this information is what allows responders to treat the patient faster.`;

const OPENING_MESSAGE =
  'I am your medical assessment assistant. I will ask you a few questions about how you are feeling to help connect you with the right medical support. What is your main concern right now?';

const FORCE_SUFFICIENT_SUFFIX =
  '\n\nYou have asked enough questions. Now respond with the SUFFICIENT JSON.';

const MAX_TURNS_BEFORE_FORCE = 8;

// Minimum BM25 score to include RAG context in the LLM's message (avoids
// polluting the AI with unrelated medical information).
const LLM_RAG_MIN_SCORE = 0.25;

// Minimum BM25 score AND a citation (articleTitle or articleSource) are both
// required to show guidance in the emergency bar.  Higher bar because this text
// is patient-facing and must be verifiably relevant.
const EMERGENCY_RAG_MIN_SCORE = 0.4;
// Minimum number of follow-up turns in critical mode before CRITICAL JSON is
// accepted from the LLM. Ensures at least 3 questions are asked (severity,
// onset/location, associated symptoms) before the report is transmitted.
const MIN_CRITICAL_QUESTIONS = 4;
// After this many turns in critical mode we force-emit regardless.
const MAX_POST_CRITICAL_TURNS = 8;

// ── Agent ─────────────────────────────────────────────────────────────────────

export class SymptomCollectorAgent {
  private conversationHistory: HistoryEntry[] = [];
  private turnCount = 0;
  private _criticalMode = false;
  private _criticalTrigger: string | null = null;
  private _postCriticalTurns = 0;
  private readonly orchestrator: typeof networkOrchestrator;

  constructor(orchestrator: typeof networkOrchestrator = networkOrchestrator) {
    this.orchestrator = orchestrator;
  }

  /**
   * Reset state and return the opening AgentResponse.
   * Called when the user taps "Begin Assessment".
   */
  async start(): Promise<AgentResponse> {
    this.conversationHistory = [];
    this.turnCount = 0;
    this._criticalMode = false;
    this._criticalTrigger = null;
    this._postCriticalTurns = 0;
    return {
      message: OPENING_MESSAGE,
      status: 'COLLECTING',
    };
  }

  /**
   * Process a user message and return the next AgentResponse.
   *
   * Safety invariant: detectCriticalSymptom runs on the RAW user input BEFORE
   * any LLM call. A network failure can never suppress a RED flag.
   *
   * Critical-mode flow:
   *   Turn 0 (user reports critical symptom) → enter _criticalMode, show
   *     emergency bar, LLM asks for severity.
   *   Turn 1 → LLM asks for other symptoms.
   *   Turn 2 (or when LLM emits CRITICAL JSON) → navigate with complete vector.
   */
  async sendMessage(userMessage: string): Promise<AgentResponse> {
    // ── 1. Safety gate: check raw user input before touching the LLM ──────────
    const userInputTrigger = detectCriticalSymptom(userMessage);

    // Always append user message to history so the LLM has full context
    this.conversationHistory.push({ role: 'user', content: userMessage });

    if (userInputTrigger && !this._criticalMode) {
      // First critical symptom detected — enter critical mode.
      // We do NOT return immediately; we call the LLM in critical mode so it
      // can ask 2 focused follow-up questions before we navigate away.
      this._criticalMode = true;
      this._criticalTrigger = userInputTrigger;
    }

    // ── 2. RAG augmentation ────────────────────────────────────────────────────
    const queryText = this._criticalTrigger ?? userMessage;
    const ragResults = await queryKnowledgeBase(queryText, 1);
    const ragItem = ragResults[0];
    // Only inject into the LLM context when the chunk is genuinely relevant —
    // irrelevant context degrades response quality more than no context at all.
    const llmRagContext =
      ragItem && ragItem.score >= LLM_RAG_MIN_SCORE ? ragItem.content : undefined;

    const messagesForLLM: LLMChatMessage[] = this.conversationHistory.map(
      (entry, idx) => {
        const isLast = idx === this.conversationHistory.length - 1;
        const augment = isLast && llmRagContext
          ? `\n\n[Medical Context: ${llmRagContext}]`
          : '';
        return { role: entry.role, content: entry.content + augment };
      },
    );

    // ── 3. Force-sufficient after MAX_TURNS (non-critical mode only) ──────────
    if (!this._criticalMode && this.turnCount >= MAX_TURNS_BEFORE_FORCE) {
      const last = messagesForLLM[messagesForLLM.length - 1];
      if (last) last.content += FORCE_SUFFICIENT_SUFFIX;
    }

    // ── 4. Choose system prompt ────────────────────────────────────────────────
    const trigger = this._criticalTrigger ?? 'symptom';
    const systemPrompt = this._criticalMode
      ? CRITICAL_MODE_SYSTEM_PROMPT.replace(/\{symptom\}/g, trigger)
      : SYSTEM_PROMPT;

    // ── 5. LLM call ───────────────────────────────────────────────────────────
    const adapter = this.orchestrator.getLLMAdapter();
    let llmResponse: string;
    try {
      llmResponse = await adapter.chat(messagesForLLM, systemPrompt);
    } catch {
      return {
        message: 'I am having trouble connecting. Please wait a moment and try again.',
        status: 'COLLECTING',
        criticalTrigger: this._criticalMode ? (this._criticalTrigger ?? undefined) : undefined,
      };
    }

    this.turnCount += 1;

    // ── 6. Parse the LLM response ─────────────────────────────────────────────
    const parsed = _tryParseJSON(llmResponse);

    if (parsed?.status === 'SUFFICIENT') {
      const summary = parsed.summary ?? 'Assessment complete.';
      const chiefComplaint = (typeof parsed.chief_complaint === 'string' && parsed.chief_complaint.trim())
        ? parsed.chief_complaint.trim()
        : '';
      return {
        message: summary,
        status: 'SUFFICIENT',
        featureVector: this.buildFeatureVector(summary, chiefComplaint),
      };
    }

    // ── 7. Critical-mode handling (must run before CRITICAL JSON check so the
    //       turn counter is in place before we decide whether to honour it)
    if (this._criticalMode) {
      this._postCriticalTurns += 1;

      if (parsed?.status === 'CRITICAL') {
        if (this._postCriticalTurns >= MIN_CRITICAL_QUESTIONS) {
          // Enough information collected — emit CRITICAL
          const emittedTrigger = parsed.trigger ?? this._criticalTrigger ?? 'critical symptom';
          const message = parsed.message ?? 'Your information has been recorded. Stay calm — help is on the way.';
          this.conversationHistory.push({ role: 'assistant', content: message });
          return {
            message,
            status: 'CRITICAL',
            criticalTrigger: emittedTrigger,
            ragContext: await this._emergencyRagContext(emittedTrigger),
            featureVector: this._buildCriticalVector(emittedTrigger),
          };
        }
        // LLM emitted CRITICAL too early — redirect to the next follow-up question
        const followUp = this._getFollowUpQuestion();
        this.conversationHistory.push({ role: 'assistant', content: followUp });
        return {
          message: followUp,
          status: 'COLLECTING',
          criticalTrigger: this._criticalTrigger ?? undefined,
          ragContext: llmRagContext,
        };
      }

      // LLM returned a natural question (sanitize to strip any accidental JSON)
      const safeCriticalResponse = _safeMessage(llmResponse, 'Can you describe what is happening?');
      this.conversationHistory.push({ role: 'assistant', content: safeCriticalResponse });

      // Force-emit CRITICAL after MAX turns regardless
      if (this._postCriticalTurns >= MAX_POST_CRITICAL_TURNS) {
        const finalTrigger = this._criticalTrigger ?? 'critical symptom';
        return {
          message: 'Thank you. Your information has been recorded and emergency help is being contacted. Stay calm.',
          status: 'CRITICAL',
          criticalTrigger: finalTrigger,
          ragContext: await this._emergencyRagContext(finalTrigger),
          featureVector: this._buildCriticalVector(finalTrigger),
        };
      }

      // Still collecting — keep input open
      return {
        message: safeCriticalResponse,
        status: 'COLLECTING',
        criticalTrigger: this._criticalTrigger ?? undefined,
        ragContext: llmRagContext,
      };
    }

    // ── 8. Normal conversational response (non-critical mode) ─────────────────
    // Always sanitize before storing/returning — prevents raw JSON leaking to the UI.
    const safeResponse = _safeMessage(llmResponse, 'Can you tell me more about your condition?');
    this.conversationHistory.push({ role: 'assistant', content: safeResponse });

    // LLM emitted CRITICAL JSON but _criticalMode was not set (user text didn't match keywords).
    // Enter critical mode now so future turns use CRITICAL_MODE_SYSTEM_PROMPT.
    if (parsed?.status === 'CRITICAL') {
      const trigger = (typeof parsed.trigger === 'string' && parsed.trigger.trim())
        ? parsed.trigger.trim()
        : detectCriticalSymptom(llmResponse) ?? 'critical symptom';
      this._criticalMode = true;
      this._criticalTrigger = trigger;
      const triggerRagResults = await queryGuidance(trigger, 1);
      return {
        message: safeResponse,
        status: 'COLLECTING',
        criticalTrigger: trigger,
        ragContext: triggerRagResults[0]?.content,
      };
    }

    // Safety check on the LLM's own text (catches prose descriptions of critical symptoms)
    const responseTrigger = detectCriticalSymptom(llmResponse);
    if (responseTrigger && !this._criticalMode) {
      this._criticalMode = true;
      this._criticalTrigger = responseTrigger;
      const triggerRagResults = await queryGuidance(responseTrigger, 1);
      return {
        message: safeResponse,
        status: 'COLLECTING',
        criticalTrigger: responseTrigger,
        ragContext: triggerRagResults[0]?.content,
      };
    }

    return {
      message: safeResponse,
      status: 'COLLECTING',
      ragContext: llmRagContext,
    };
  }

  /**
   * Build a feature vector from whatever conversation history exists.
   * Used for the SUFFICIENT path where history is complete.
   */
  buildFeatureVector(summary: string, extractedChiefComplaint = ''): MedicalFeatureVector {
    const userMessages = this.conversationHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content);

    // Prefer the LLM-extracted chief complaint (clinically worded);
    // fall back to the user's first raw message only if not available.
    const chiefComplaint = extractedChiefComplaint.trim() || userMessages[0] || 'Not provided';

    // Severity — last standalone digit 1–10 anywhere in user messages
    let severity = 5;
    for (const msg of userMessages) {
      const matches = msg.match(/\b([1-9]|10)\b/g);
      if (matches) {
        const last = parseInt(matches[matches.length - 1]!, 10);
        if (last >= 1 && last <= 10) severity = last;
      }
    }

    // Onset — first recognisable time reference in any user message
    let onsetTime = 'Unknown';
    const onsetRe =
      /(\d+\s*(?:hour|hr|day|minute|min|week)s?\s*ago|since\s+\w+|yesterday|this morning|last night|a few hours|just now)/i;
    for (const msg of userMessages) {
      const match = msg.match(onsetRe);
      if (match) { onsetTime = match[0]; break; }
    }

    const associatedSymptoms = userMessages
      .slice(1)
      .filter(
        (m) =>
          m.length > 3 &&
          !/^\d+$/.test(m) &&
          !/^(yes|no|none|nothing|nope|yeah|yep)$/i.test(m),
      )
      .slice(0, 6);

    const allergies: string[] = [];
    const allergyRe = /allergic to ([^,.]+)/i;
    for (const msg of userMessages) {
      const match = msg.match(allergyRe);
      if (match?.[1]) allergies.push(match[1].trim());
    }

    return {
      chiefComplaint,
      onsetTime,
      severity,
      associatedSymptoms,
      allergies,
      conversationSummary: summary,
      rawTranscript: this.conversationHistory,
    };
  }

  /**
   * Returns a sensible follow-up question when the LLM tries to emit CRITICAL
   * JSON before the minimum number of questions have been asked.
   */
  private _getFollowUpQuestion(): string {
    const questions = [
      'How severe is it on a scale of 1 to 10?',
      'When did this happen — just now, or some time ago?',
      'Where exactly on your body is the problem?',
      'Are you experiencing anything else — dizziness, weakness, or difficulty breathing?',
      'Do you have any known allergies to medications?',
    ];
    const idx = Math.min(this._postCriticalTurns - 1, questions.length - 1);
    return questions[idx] ?? questions[questions.length - 1]!;
  }

  /**
   * Build a feature vector for the CRITICAL path, using whatever
   * follow-up info the agent collected after the critical keyword fired.
   */
  private _buildCriticalVector(trigger: string): MedicalFeatureVector {
    const userMessages = this.conversationHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content);

    const chiefComplaint = `Emergency: ${trigger.charAt(0).toUpperCase() + trigger.slice(1)}`;

    // Extract severity from any user message; default to 7 if never reported
    let severity = 7;
    for (const msg of userMessages) {
      const matches = msg.match(/\b([1-9]|10)\b/g);
      if (matches) {
        const last = parseInt(matches[matches.length - 1]!, 10);
        if (last >= 1 && last <= 10) severity = last;
      }
    }

    // Symptoms from follow-up answers (messages after first one)
    const associatedSymptoms = userMessages
      .slice(1)
      .filter((m) => m.length > 3 && !/^\d+$/.test(m))
      .slice(0, 4);

    if (!associatedSymptoms.some((s) => s.toLowerCase().includes(trigger.toLowerCase()))) {
      associatedSymptoms.unshift(trigger);
    }

    const summary = `EMERGENCY — Patient reported: ${trigger}. Full account: ${userMessages.join('. ')}`;

    return {
      chiefComplaint,
      onsetTime: 'Unknown — emergency presentation',
      severity,
      associatedSymptoms,
      allergies: [],
      conversationSummary: summary,
      rawTranscript: this.conversationHistory,
    };
  }

  /**
   * Returns emergency-bar guidance text only when the top RAG result is both
   * above the relevance threshold AND has a citable source.
   * Returns undefined if the knowledge base has nothing genuinely useful to say —
   * it is always better to show nothing than to show irrelevant medical advice.
   */
  private async _emergencyRagContext(trigger: string): Promise<string | undefined> {
    const results = await queryGuidance(trigger, 1);
    const item = results[0];
    if (!item || item.score < EMERGENCY_RAG_MIN_SCORE) return undefined;
    const source = item.articleTitle ?? item.articleSource;
    if (!source) return undefined;
    return `${item.content}\n\n📚 Source: ${source}`;
  }

  getSerializableState(): AgentSerializableState {
    return {
      history: [...this.conversationHistory],
      turnCount: this.turnCount,
      criticalMode: this._criticalMode,
      criticalTrigger: this._criticalTrigger,
      postCriticalTurns: this._postCriticalTurns,
    };
  }

  restoreState(state: AgentSerializableState): void {
    this.conversationHistory = state.history ?? [];
    this.turnCount = state.turnCount ?? 0;
    this._criticalMode = state.criticalMode ?? false;
    this._criticalTrigger = state.criticalTrigger ?? null;
    this._postCriticalTurns = state.postCriticalTurns ?? 0;
  }

  reset(): void {
    this.conversationHistory = [];
    this.turnCount = 0;
    this._criticalMode = false;
    this._criticalTrigger = null;
    this._postCriticalTurns = 0;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _tryParseJSON(
  text: string,
): Record<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Returns the human-readable `message` field from a JSON string, or the
 * original string if it is not JSON. Prevents raw JSON blobs from leaking
 * into the chat UI when the LLM emits a status token in an unexpected turn.
 */
function _safeMessage(text: string, fallback: string): string {
  const p = _tryParseJSON(text);
  if (!p) return text;
  return typeof p.message === 'string' && p.message.trim().length > 0
    ? p.message.trim()
    : fallback;
}
