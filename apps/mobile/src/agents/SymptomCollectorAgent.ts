// Hand-written agent loop for the mobile app.
// Does NOT use Google ADK — ADK requires a Python runtime which is unavailable offline.
// All LLM calls go through NetworkOrchestrator.getLLMAdapter() — never directly.

import { networkOrchestrator } from '../services/network/NetworkOrchestrator';
import { queryKnowledgeBase } from '../services/rag/LocalRAG';
import {
  detectCriticalSymptom,
  type MedicalFeatureVector,
} from '../services/triage/TriageEngine';
import type { ChatMessage as LLMChatMessage } from '../services/llm/LLMAdapter.interface';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentStatus = 'COLLECTING' | 'SUFFICIENT' | 'CRITICAL';

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
{"status":"SUFFICIENT","summary":"<2 sentence summary of the patient's condition>"}

If the patient mentions ANY of these critical symptoms, respond ONLY with this exact JSON immediately:
chest pain, difficulty breathing, cannot breathe, uncontrolled bleeding, unconscious, seizure, crush injury, snake bite, stroke, severe burn, choking, amputation, electric shock:
{"status":"CRITICAL","trigger":"<the symptom mentioned>","message":"<one sentence of immediate safety advice>"}

Never break character. Never say you are an AI.
Introduce yourself as: "I am your medical assessment assistant."`;

const OPENING_MESSAGE =
  'I am your medical assessment assistant. I will ask you a few questions about how you are feeling to help connect you with the right medical support. What is your main concern right now?';

const FORCE_SUFFICIENT_SUFFIX =
  '\n\nYou have asked enough questions. Now respond with the SUFFICIENT JSON.';

const MAX_TURNS_BEFORE_FORCE = 8;

// ── Agent ─────────────────────────────────────────────────────────────────────

export class SymptomCollectorAgent {
  private conversationHistory: HistoryEntry[] = [];
  private turnCount = 0;
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
   */
  async sendMessage(userMessage: string): Promise<AgentResponse> {
    // ── 1. Safety gate: check raw user input before touching the LLM ──────────
    const userInputTrigger = detectCriticalSymptom(userMessage);
    if (userInputTrigger) {
      const ragResults = await queryKnowledgeBase(userInputTrigger, 1);
      return {
        message:
          'This sounds like a medical emergency. Stay calm, do not move if injured, and call for help immediately. Your information is being recorded.',
        status: 'CRITICAL',
        criticalTrigger: userInputTrigger,
        ragContext: ragResults[0]?.content,
      };
    }

    // ── 2. Append user message to history ────────────────────────────────────
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // ── 3. RAG augmentation (appended as invisible context, not shown) ────────
    const ragResults = await queryKnowledgeBase(userMessage, 1);
    const ragContext = ragResults[0]?.content;

    // Build the messages sent to the LLM — augment the last user turn with
    // RAG context if available.  The stored history is never modified.
    const messagesForLLM: LLMChatMessage[] = this.conversationHistory.map(
      (entry, idx) => {
        const isLast = idx === this.conversationHistory.length - 1;
        const augment = isLast && ragContext
          ? `\n\n[Medical Context: ${ragContext}]`
          : '';
        return {
          role: entry.role,
          content: entry.content + augment,
        };
      },
    );

    // ── 4. Force summary after MAX_TURNS_BEFORE_FORCE ─────────────────────────
    if (this.turnCount >= MAX_TURNS_BEFORE_FORCE) {
      const last = messagesForLLM[messagesForLLM.length - 1];
      if (last) last.content += FORCE_SUFFICIENT_SUFFIX;
    }

    // ── 5. LLM call ───────────────────────────────────────────────────────────
    const adapter = this.orchestrator.getLLMAdapter();
    let llmResponse: string;
    try {
      llmResponse = await adapter.chat(messagesForLLM, SYSTEM_PROMPT);
    } catch {
      // LLM unavailable — ask the user to wait
      return {
        message:
          'I am having trouble connecting. Please wait a moment and try again.',
        status: 'COLLECTING',
      };
    }

    this.turnCount += 1;

    // ── 6. Parse the LLM response ─────────────────────────────────────────────
    const parsed = _tryParseJSON(llmResponse);

    if (parsed) {
      if (parsed.status === 'SUFFICIENT') {
        const summary: string = parsed.summary ?? 'Assessment complete.';
        return {
          message: summary,
          status: 'SUFFICIENT',
          featureVector: this.buildFeatureVector(summary),
        };
      }

      if (parsed.status === 'CRITICAL') {
        const trigger: string = parsed.trigger ?? 'critical symptom';
        const message: string =
          parsed.message ??
          'This sounds like a medical emergency. Stay calm and call for help immediately.';
        const triggerRagResults = await queryKnowledgeBase(trigger, 1);
        return {
          message,
          status: 'CRITICAL',
          criticalTrigger: trigger,
          ragContext: triggerRagResults[0]?.content,
        };
      }
    }

    // Plain conversational response — add to history
    this.conversationHistory.push({ role: 'assistant', content: llmResponse });

    // Safety check on the LLM's own text (catches cases where the model
    // describes a critical symptom in prose instead of emitting the JSON token)
    const responseTrigger = detectCriticalSymptom(llmResponse);
    if (responseTrigger) {
      const triggerRagResults = await queryKnowledgeBase(responseTrigger, 1);
      return {
        message: llmResponse,
        status: 'CRITICAL',
        criticalTrigger: responseTrigger,
        ragContext: triggerRagResults[0]?.content,
      };
    }

    return {
      message: llmResponse,
      status: 'COLLECTING',
      ragContext,
    };
  }

  /**
   * Construct a MedicalFeatureVector from the conversation history.
   * Called internally when the LLM signals SUFFICIENT.
   */
  buildFeatureVector(summary: string): MedicalFeatureVector {
    const userMessages = this.conversationHistory
      .filter((m) => m.role === 'user')
      .map((m) => m.content);

    const chiefComplaint = userMessages[0] ?? 'Not provided';

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

    // Associated symptoms — user messages after the chief complaint that are
    // not bare numbers and not simple yes/no/none confirmations
    const associatedSymptoms = userMessages
      .slice(1)
      .filter(
        (m) =>
          m.length > 3 &&
          !/^\d+$/.test(m) &&
          !/^(yes|no|none|nothing|nope|yeah|yep)$/i.test(m),
      )
      .slice(0, 6);

    // Allergies — simple "allergic to X" pattern
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

  reset(): void {
    this.conversationHistory = [];
    this.turnCount = 0;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _tryParseJSON(
  text: string,
): Record<string, string> | null {
  const trimmed = text.trim();
  // Only attempt to parse if it looks like a JSON object
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as Record<string, string>;
  } catch {
    return null;
  }
}
