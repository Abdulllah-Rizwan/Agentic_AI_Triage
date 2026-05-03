import { networkOrchestrator } from '../services/network/NetworkOrchestrator';
import { useChatStore } from '../store/chatStore';
import { ChatMessage as LLMChatMessage } from '../services/llm/LLMAdapter.interface';
import { queryKnowledgeBase } from '../services/rag/LocalRAG';
import { MedicalFeatureVector } from '../services/triage/TriageEngine';

const SYSTEM_PROMPT = `You are a compassionate first-response triage assistant deployed in a disaster zone.
Your ONLY job is to collect patient symptoms clearly and systematically.
Do NOT diagnose. Do NOT prescribe. Do NOT reference medications by name.
Ask ONE question at a time. Use simple language.
When you have: chief complaint, onset time, severity (1-10), 2-3 associated symptoms,
and any known allergies — respond ONLY with the JSON token: {"status":"SUFFICIENT"}.
If the patient mentions: chest pain, cannot breathe, heavy bleeding, unconscious,
crush injury, or seizure — respond ONLY with: {"status":"CRITICAL","trigger":"<symptom>"}.`;

const RAG_SIMILARITY_THRESHOLD = 0.75;

export interface AgentStatusEvent {
  status: 'SUFFICIENT' | 'CRITICAL';
  trigger?: string;
}

type HistoryEntry = { role: 'user' | 'assistant'; content: string };

export class SymptomCollectorAgent {
  private conversationHistory: HistoryEntry[] = [];

  async start(): Promise<string> {
    const store = useChatStore.getState();
    store.setCollectionStatus('COLLECTING');
    const greeting = await this._callLLM('Hello, I need medical help.');
    return greeting;
  }

  async sendMessage(userMessage: string): Promise<string | AgentStatusEvent> {
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // RAG augmentation
    const ragResults = await queryKnowledgeBase(userMessage);
    const relevantContext = ragResults
      .filter((r) => r.score >= RAG_SIMILARITY_THRESHOLD)
      .map((r) => r.content)
      .join('\n');

    const augmentedHistory = relevantContext
      ? [
          ...this.conversationHistory.slice(0, -1),
          {
            role: 'user' as const,
            content: `${userMessage}\n\n[Context: ${relevantContext}]`,
          },
        ]
      : this.conversationHistory;

    const response = await this._callLLM(augmentedHistory[augmentedHistory.length - 1]?.content ?? userMessage);
    this.conversationHistory.push({ role: 'assistant', content: response });

    // Detect structured status tokens
    try {
      const parsed = JSON.parse(response) as { status?: string; trigger?: string };
      if (parsed.status === 'SUFFICIENT' || parsed.status === 'CRITICAL') {
        return { status: parsed.status as 'SUFFICIENT' | 'CRITICAL', trigger: parsed.trigger };
      }
    } catch {
      // Not JSON — normal chat response
    }

    return response;
  }

  buildFeatureVector(chiefComplaint: string): MedicalFeatureVector {
    const summary = this.conversationHistory
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    return {
      chiefComplaint,
      onsetTime: 'Unknown',
      severity: 5,
      associatedSymptoms: [],
      allergies: [],
      conversationSummary: summary,
      rawTranscript: this.conversationHistory,
    };
  }

  reset(): void {
    this.conversationHistory = [];
    useChatStore.getState().clearChat();
  }

  private async _callLLM(userContent: string): Promise<string> {
    const adapter = networkOrchestrator.getLLMAdapter();
    const messages: LLMChatMessage[] = this.conversationHistory.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: m.content,
    }));

    if (messages.length === 0 || messages[messages.length - 1]?.content !== userContent) {
      messages.push({ role: 'user', content: userContent });
    }

    return adapter.chat(messages, SYSTEM_PROMPT);
  }
}
