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

// ── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `[ROLE]
You are a calm, compassionate field triage interviewer for a disaster medical response app. You are not a doctor.

[INSTRUCTION]
Collect symptom information from the patient by asking ONE short question per turn. After each answer, decide the next most useful question. Continue until you have enough to fill the Medical Feature Vector defined in [OUTPUT FORMAT]. Then stop asking and emit the vector.

[CONTEXT]
- The patient is in a disaster zone (earthquake, flood, collapse).
- They are likely scared, tired, possibly injured, possibly low-literacy.
- They may answer in English, Urdu, or Roman Urdu — mirror their language.
- This conversation runs on their phone. No doctor is available. Quality of data determines whether help arrives in time.
- Your output becomes input to a triage classifier that dispatches emergency responders.

[EXAMPLE]
Patient: "mera pair bohat dard kar raha hai"
You: "Kab se dard ho raha hai? (How long has it been hurting?)"
Patient: "earthquake ke baad se, koi 2 ghante"
You: "Kya aap chal sakte hain ya pair hila sakte hain?"

[CONSTRAINTS]
- ONE question per turn. Never stack questions.
- Maximum 15 words per question.
- NEVER diagnose ("you have a fracture").
- NEVER prescribe medication or dosages.
- NEVER promise outcomes ("you'll be fine").
- NEVER use medical jargon (say "broken bone" not "fracture", "trouble breathing" not "dyspnea").
- Do not use markdown, bullets, or formatting in conversation.
- Never break character. Never say you are an AI.

[OUTPUT FORMAT]
While interviewing: plain text, one question only.

When you have chief complaint + onset + severity (1–10) + associated symptoms + allergy status — emit ONLY this JSON, nothing else before or after:
{"status":"SUFFICIENT","chief_complaint":"<clinically worded 3–8 word phrase>","onset_hours":<number or null>,"pain_scale":<0–10 or null>,"location_on_body":"<body area or null>","associated_symptoms":[<short strings>],"mobility":"walking|limited|immobile|unknown","consciousness":"alert|drowsy|confused|unknown","bleeding":"none|minor|heavy|unknown","language_used":"en|ur|roman_ur","summary":"<2-sentence clinical summary of the patient's condition>"}

If the patient mentions any RED-FLAG symptom — chest pain, breathing difficulty, heavy bleeding, unconsciousness, severe head injury, stroke signs, crush injury, seizure, snake bite, amputation, electric shock, severe burn — emit ONLY this JSON immediately:
{"status":"CRITICAL","trigger":"<the symptom mentioned>","message":"<one sentence of immediate safety advice>"}`;

// Used when a critical symptom has been detected — replaces SYSTEM_PROMPT so
// the LLM gathers comprehensive clinical detail before emitting CRITICAL JSON.
// After MAX_POST_CRITICAL_TURNS we force-emit CRITICAL regardless.
const CRITICAL_MODE_SYSTEM_PROMPT = `[ROLE]
You are an emergency triage interviewer in a life-threat situation.

[INSTRUCTION]
A red-flag symptom has been reported: {symptom}. Rapidly extract the five facts listed in [OUTPUT FORMAT] in as few questions as possible. Emit the JSON the moment you have all five, even if details are partial.

[CONTEXT]
- The patient or a bystander has reported one of: chest pain, breathing difficulty, heavy bleeding, unconsciousness, severe head trauma, or stroke signs.
- Every additional question delays the emergency dispatch.
- The responder reading this output is making a life-or-death rescue prioritization decision.
- One sentence reassurance only: "Help is being sent now. Stay with the patient."

[EXAMPLE]
You: "Kya patient saans le raha hai? (Is patient breathing?)"
User: "haan lekin bohat mushkil se"
You: "Yeh kab shuru hua?"
User: "10 minute pehle"

[CONSTRAINTS]
- MAXIMUM 5 questions total. Hard limit.
- Prioritize in this order: airway/breathing → bleeding → consciousness → onset → progression.
- Ask ONE question per turn. Read the full conversation — do NOT re-ask anything already answered.
- NEVER instruct CPR, tourniquet placement, or any procedure unless asked directly.
- NEVER say "you'll be okay" or any survival prediction.
- NEVER diagnose. NEVER name medications.
- If patient/bystander cannot answer (unconscious, panicking), mark fields as "unknown" and emit immediately.

[OUTPUT FORMAT]
While gathering information: plain text, one question only.

When you have all five data points (or patient cannot respond), emit ONLY this JSON:
{"status":"CRITICAL","trigger":"{symptom}","critical_flag":"chest_pain|breathing|bleeding|unconscious|head_injury|stroke","onset_minutes":<number or "unknown">,"severity":"moderate|severe|critical","progression":"improving|stable|worsening|unknown","patient_responsive":true|false,"associated_symptoms":[<short strings>],"message":"<one brief calm safety instruction appropriate to the symptom>"}`;

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
      const summary = (typeof parsed.summary === 'string' && parsed.summary) ? parsed.summary : 'Assessment complete.';
      const chiefComplaint = (typeof parsed.chief_complaint === 'string' && parsed.chief_complaint.trim())
        ? parsed.chief_complaint.trim()
        : '';
      return {
        message: summary,
        status: 'SUFFICIENT',
        featureVector: this.buildFeatureVector(summary, chiefComplaint, parsed),
      };
    }

    // ── 7. Critical-mode handling (must run before CRITICAL JSON check so the
    //       turn counter is in place before we decide whether to honour it)
    if (this._criticalMode) {
      this._postCriticalTurns += 1;

      if (parsed?.status === 'CRITICAL') {
        if (this._postCriticalTurns >= MIN_CRITICAL_QUESTIONS) {
          // Enough information collected — emit CRITICAL
          const emittedTrigger = (typeof parsed.trigger === 'string' && parsed.trigger) ? parsed.trigger : (this._criticalTrigger ?? 'critical symptom');
          const message = (typeof parsed.message === 'string' && parsed.message) ? parsed.message : 'Your information has been recorded. Stay calm — help is on the way.';
          this.conversationHistory.push({ role: 'assistant', content: message });
          return {
            message,
            status: 'CRITICAL',
            criticalTrigger: emittedTrigger,
            ragContext: await this._emergencyRagContext(emittedTrigger),
            featureVector: this._buildCriticalVector(emittedTrigger, parsed),
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
        : (detectCriticalSymptom(llmResponse) ?? 'critical symptom');
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
   *
   * When `parsed` is provided (the LLM's SUFFICIENT JSON), its structured fields
   * take priority over regex-based extraction from the conversation transcript.
   */
  buildFeatureVector(
    summary: string,
    extractedChiefComplaint = '',
    parsed?: Record<string, unknown>,
  ): MedicalFeatureVector {
    const userMessages = this.conversationHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content);

    // Prefer the LLM-extracted chief complaint (clinically worded)
    const chiefComplaint = extractedChiefComplaint.trim() || userMessages[0] || 'Not provided';

    // Severity — prefer LLM-provided pain_scale; fall back to regex extraction
    let severity = 5;
    if (typeof parsed?.pain_scale === 'number' && parsed.pain_scale >= 1 && parsed.pain_scale <= 10) {
      severity = Math.round(parsed.pain_scale);
    } else {
      for (const msg of userMessages) {
        const matches = msg.match(/\b([1-9]|10)\b/g);
        if (matches) {
          const last = parseInt(matches[matches.length - 1]!, 10);
          if (last >= 1 && last <= 10) severity = last;
        }
      }
    }

    // Onset — prefer LLM-provided onset_hours; fall back to regex extraction
    let onsetTime = 'Unknown';
    if (typeof parsed?.onset_hours === 'number' && parsed.onset_hours >= 0) {
      onsetTime = parsed.onset_hours < 1
        ? `${Math.round(parsed.onset_hours * 60)} minutes ago`
        : `${parsed.onset_hours} hour${parsed.onset_hours !== 1 ? 's' : ''} ago`;
    } else {
      const onsetRe =
        /(\d+\s*(?:hour|hr|day|minute|min|week)s?\s*ago|since\s+\w+|yesterday|this morning|last night|a few hours|just now)/i;
      for (const msg of userMessages) {
        const match = msg.match(onsetRe);
        if (match) { onsetTime = match[0]; break; }
      }
    }

    // Associated symptoms — prefer LLM-extracted array; fall back to heuristic
    let associatedSymptoms: string[];
    if (Array.isArray(parsed?.associated_symptoms) && (parsed.associated_symptoms as unknown[]).length > 0) {
      associatedSymptoms = (parsed.associated_symptoms as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .slice(0, 6);
    } else {
      associatedSymptoms = userMessages
        .slice(1)
        .filter(
          (m) =>
            m.length > 3 &&
            !/^\d+$/.test(m) &&
            !/^(yes|no|none|nothing|nope|yeah|yep)$/i.test(m),
        )
        .slice(0, 6);
    }

    // Allergies — regex extraction (not in new prompt output schema)
    const allergies: string[] = [];
    const allergyRe = /allergic to ([^,.]+)/i;
    for (const msg of userMessages) {
      const match = msg.match(allergyRe);
      if (match?.[1]) allergies.push(match[1].trim());
    }

    // Append extra context fields from the richer JSON to the summary
    const extras: string[] = [];
    if (parsed?.location_on_body && parsed.location_on_body !== 'null' && parsed.location_on_body !== null) {
      extras.push(`Location: ${parsed.location_on_body}`);
    }
    if (parsed?.mobility && parsed.mobility !== 'unknown') {
      extras.push(`Mobility: ${parsed.mobility}`);
    }
    if (parsed?.consciousness && parsed.consciousness !== 'unknown') {
      extras.push(`Consciousness: ${parsed.consciousness}`);
    }
    if (parsed?.bleeding && parsed.bleeding !== 'none' && parsed.bleeding !== 'unknown') {
      extras.push(`Bleeding: ${parsed.bleeding}`);
    }
    const fullSummary = extras.length > 0
      ? `${summary} Additional: ${extras.join(', ')}.`
      : summary;

    return {
      chiefComplaint,
      onsetTime,
      severity,
      associatedSymptoms,
      allergies,
      conversationSummary: fullSummary,
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
   *
   * When `parsed` is provided (the LLM's CRITICAL JSON), its structured
   * fields take priority over heuristic extraction.
   */
  private _buildCriticalVector(trigger: string, parsed?: Record<string, unknown>): MedicalFeatureVector {
    const userMessages = this.conversationHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content);

    const chiefComplaint = `Emergency: ${trigger.charAt(0).toUpperCase() + trigger.slice(1)}`;

    // Onset — prefer LLM-provided onset_minutes
    let onsetTime = 'Unknown — emergency presentation';
    if (typeof parsed?.onset_minutes === 'number' && parsed.onset_minutes >= 0) {
      onsetTime = `${parsed.onset_minutes} minute${parsed.onset_minutes !== 1 ? 's' : ''} ago`;
    } else if (parsed?.onset_minutes === 'unknown') {
      onsetTime = 'Unknown — emergency presentation';
    }

    // Severity — prefer LLM-provided severity string; fall back to regex
    let severity = 8;
    if (parsed?.severity === 'critical') {
      severity = 10;
    } else if (parsed?.severity === 'severe') {
      severity = 8;
    } else if (parsed?.severity === 'moderate') {
      severity = 6;
    } else {
      for (const msg of userMessages) {
        const matches = msg.match(/\b([1-9]|10)\b/g);
        if (matches) {
          const last = parseInt(matches[matches.length - 1]!, 10);
          if (last >= 1 && last <= 10) { severity = last; break; }
        }
      }
    }

    // Associated symptoms — prefer LLM array; fall back to heuristic
    let associatedSymptoms: string[];
    if (Array.isArray(parsed?.associated_symptoms) && (parsed.associated_symptoms as unknown[]).length > 0) {
      associatedSymptoms = (parsed.associated_symptoms as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .slice(0, 4);
    } else {
      associatedSymptoms = userMessages
        .slice(1)
        .filter((m) => m.length > 3 && !/^\d+$/.test(m))
        .slice(0, 4);
    }

    if (!associatedSymptoms.some((s) => s.toLowerCase().includes(trigger.toLowerCase()))) {
      associatedSymptoms.unshift(trigger);
    }

    // Enrich summary with progression and responsiveness when available
    const progressionNote = typeof parsed?.progression === 'string' && parsed.progression !== 'unknown'
      ? ` Condition is ${parsed.progression}.`
      : '';
    const responsiveNote = parsed?.patient_responsive === false
      ? ' Patient is unresponsive.'
      : '';

    const summary = `EMERGENCY — Patient reported: ${trigger}.${progressionNote}${responsiveNote} Full account: ${userMessages.join('. ')}`;

    return {
      chiefComplaint,
      onsetTime,
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
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
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
