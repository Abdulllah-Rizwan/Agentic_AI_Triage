import { LLMAdapter, ChatMessage, LLMUnavailableError } from './LLMAdapter.interface';
import { logger } from '../../utils/logger';

const TAG = 'CloudLLM';
const API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY ?? '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
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
  constructor() {
    if (!API_KEY) {
      logger.error(TAG, 'EXPO_PUBLIC_GROQ_API_KEY is not set — cloud LLM will fail on every call');
    }
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    logger.info(TAG, 'chat() called', { model: MODEL, turns: messages.length });

    const body = {
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      ],
      temperature: 0.3,
      max_tokens: 1024,
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        logger.debug(TAG, `attempt ${attempt + 1}/${MAX_RETRIES}`);

        const response = await withTimeout(
          fetch(GROQ_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify(body),
          }),
          TIMEOUT_MS,
        );

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          logger.error(TAG, `attempt ${attempt + 1} failed`, { status: response.status, body: errText });
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json() as {
          choices: Array<{ message: { content: string } }>;
        };
        const text = data.choices[0]?.message?.content ?? '';
        logger.info(TAG, `success on attempt ${attempt + 1}`, { responseLength: text.length });
        return text;

      } catch (err) {
        logger.error(TAG, `attempt ${attempt + 1} failed`, {
          error: String(err),
          message: (err as Error)?.message,
        });

        const isLast = attempt === MAX_RETRIES - 1;
        if (isLast) {
          throw new LLMUnavailableError(
            `Cloud LLM unavailable after ${MAX_RETRIES} attempts: ${String(err)}`,
          );
        }
        const backoff = 1000 * Math.pow(2, attempt);
        logger.debug(TAG, `retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }

    throw new LLMUnavailableError('Cloud LLM unavailable');
  }

  async isAvailable(): Promise<boolean> {
    if (!API_KEY) {
      logger.warn(TAG, 'isAvailable() → false (no API key)');
      return false;
    }
    try {
      const response = await withTimeout(
        fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${API_KEY}` },
        }),
        5000,
      );
      const available = response.ok;
      logger.info(TAG, `isAvailable() → ${available}`, { status: response.status });
      return available;
    } catch (err) {
      logger.warn(TAG, 'isAvailable() → false', { error: String(err) });
      return false;
    }
  }
}
