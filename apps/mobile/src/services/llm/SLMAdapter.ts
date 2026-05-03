import { LLMAdapter, ChatMessage, LLMUnavailableError } from './LLMAdapter.interface';

const IS_DEV = process.env.EXPO_PUBLIC_ENVIRONMENT === 'development';
const OLLAMA_URL = process.env.EXPO_PUBLIC_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = 'llama3.2:1b';
const MAX_TOKENS = 512;
const TEMPERATURE = 0.3;

function formatLlama32Prompt(messages: ChatMessage[], systemPrompt: string): string {
  const parts: string[] = [];
  parts.push(`<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${systemPrompt}<|eot_id|>`);
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    parts.push(`<|start_header_id|>${role}<|end_header_id|>\n${m.content}<|eot_id|>`);
  }
  parts.push('<|start_header_id|>assistant<|end_header_id|>');
  return parts.join('');
}

export class SLMAdapter implements LLMAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private llm: any | null = null;
  private isReady: boolean = false;
  private isLoading: boolean = false;

  async initialize(): Promise<void> {
    if (this.isReady || this.isLoading) return;
    this.isLoading = true;

    try {
      if (IS_DEV) {
        this.isReady = true;
        return;
      }

      // Dynamic import so llama.rn is not required in dev/web builds
      const { initLlama } = await import('llama.rn');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const modelAsset = require('../../assets/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf');

      this.llm = await initLlama({
        model: modelAsset,
        use_mlock: true,
        n_ctx: 2048,
        n_threads: 4,
      });

      this.isReady = true;
    } catch (err) {
      console.error('[SLMAdapter] Failed to initialize model:', err);
      this.isReady = false;
    } finally {
      this.isLoading = false;
    }
  }

  isModelReady(): boolean {
    return this.isReady;
  }

  async isAvailable(): Promise<boolean> {
    return this.isReady;
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    if (!this.isReady) {
      throw new LLMUnavailableError('SLM is not ready');
    }

    if (IS_DEV) {
      return this._callOllama(messages, systemPrompt);
    }

    return this._callLlamaRn(messages, systemPrompt);
  }

  private async _callOllama(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: ollamaMessages,
          stream: false,
          options: { temperature: TEMPERATURE, num_predict: MAX_TOKENS },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}`);
      }

      const data = await response.json() as { message?: { content?: string } };
      return data.message?.content ?? '';
    } catch (err) {
      throw new LLMUnavailableError(`Ollama unavailable: ${String(err)}`);
    }
  }

  private async _callLlamaRn(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    if (!this.llm) {
      throw new LLMUnavailableError('llama.rn context not initialized');
    }

    const prompt = formatLlama32Prompt(messages, systemPrompt);

    try {
      const result = await this.llm.completion({
        prompt,
        n_predict: MAX_TOKENS,
        temperature: TEMPERATURE,
        stop: ['<|eot_id|>', '<|end_of_text|>'],
      });

      return (result as { text: string }).text.trim();
    } catch (err) {
      throw new LLMUnavailableError(`llama.rn inference failed: ${String(err)}`);
    }
  }
}

export const slmAdapter = new SLMAdapter();
