import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { LLMAdapter, ChatMessage, LLMUnavailableError } from './LLMAdapter.interface';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const MODEL_NAME = 'gemini-2.0-flash';
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export class CloudLLMAdapter implements LLMAdapter {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(API_KEY);
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: systemPrompt,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });

    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMessage = messages[messages.length - 1];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const chat = model.startChat({ history });
        const result = await withTimeout(
          chat.sendMessage(lastMessage?.content ?? ''),
          TIMEOUT_MS,
        );
        return result.response.text();
      } catch (err) {
        const isLast = attempt === MAX_RETRIES - 1;
        if (isLast) {
          throw new LLMUnavailableError(
            `Cloud LLM unavailable after ${MAX_RETRIES} attempts: ${String(err)}`,
          );
        }
        await sleep(1000 * Math.pow(2, attempt));
      }
    }

    throw new LLMUnavailableError('Cloud LLM unavailable');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const model = this.genAI.getGenerativeModel({ model: MODEL_NAME });
      await withTimeout(model.generateContent('ping'), 5000);
      return true;
    } catch {
      return false;
    }
  }
}
