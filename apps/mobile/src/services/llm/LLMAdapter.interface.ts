export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMAdapter {
  chat(messages: ChatMessage[], systemPrompt: string): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMUnavailableError';
  }
}
