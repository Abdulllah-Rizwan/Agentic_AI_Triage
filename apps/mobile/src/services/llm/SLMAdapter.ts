import * as FileSystem from 'expo-file-system/legacy';
import { LLMAdapter, ChatMessage, LLMUnavailableError } from './LLMAdapter.interface';
import { logger } from '../../utils/logger';

const TAG = 'SLMAdapter';
const IS_DEV = process.env.EXPO_PUBLIC_ENVIRONMENT === 'development';
const OLLAMA_URL = process.env.EXPO_PUBLIC_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen2.5:1.5b';
const MAX_TOKENS = 512;
const TEMPERATURE = 0.3;

const MODEL_FILENAME = 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf';
const MODEL_DIR = (FileSystem.documentDirectory ?? '') + 'models/';
export const MODEL_PATH = MODEL_DIR + MODEL_FILENAME;
const MODEL_URL =
  'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/' + MODEL_FILENAME;

// Old Llama model — deleted automatically on first launch after upgrade
const OLD_MODEL_PATH = MODEL_DIR + 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

// Qwen2.5 uses ChatML format
function formatChatMLPrompt(messages: ChatMessage[], systemPrompt: string): string {
  const parts: string[] = [
    `<|im_start|>system\n${systemPrompt}<|im_end|>`,
  ];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    parts.push(`<|im_start|>${role}\n${m.content}<|im_end|>`);
  }
  parts.push('<|im_start|>assistant');
  return parts.join('\n');
}

export class SLMAdapter implements LLMAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private llm: any | null = null;
  private isReady: boolean = false;
  private isLoading: boolean = false;
  // Cached promise so llama.rn is loaded at most once in dev mode
  private _llamaRnLoadPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.isReady || this.isLoading) return;
    this.isLoading = true;

    try {
      // Delete the old Llama 3.2 1B model if still present — frees ~807 MB
      const oldInfo = await FileSystem.getInfoAsync(OLD_MODEL_PATH);
      if (oldInfo.exists) {
        await FileSystem.deleteAsync(OLD_MODEL_PATH, { idempotent: true });
        logger.info(TAG, 'Deleted old Llama model', { path: OLD_MODEL_PATH });
      }

      if (IS_DEV) {
        logger.info(TAG, 'dev mode — routing to Ollama', { url: OLLAMA_URL, model: OLLAMA_MODEL });
        this.isReady = true;
        // Eagerly load llama.rn in the background so it's ready if Ollama is
        // unreachable (e.g. WiFi off during offline testing). Silently no-ops in
        // Expo Go where the native module is unavailable.
        this._ensureLlamaRnLoaded();
        return;
      }

      // Model lives in device storage (documentDirectory), never bundled via Metro.
      // It is downloaded at runtime on first launch via downloadModel().
      const info = await FileSystem.getInfoAsync(MODEL_PATH);
      if (!info.exists) {
        logger.warn(TAG, 'Model file not found — offline mode unavailable', { path: MODEL_PATH });
        this.isReady = false;
        return;
      }

      // Dynamic import keeps llama.rn out of the web/dev bundle
      const { initLlama } = await import('llama.rn');

      this.llm = await initLlama({
        model: MODEL_PATH,
        use_mlock: true,
        n_ctx: 1024,
        n_threads: 4,
      });

      this.isReady = true;
      logger.info(TAG, 'Model loaded', { path: MODEL_PATH });
    } catch (err) {
      logger.error(TAG, 'Failed to initialize model', { error: String(err) });
      this.isReady = false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Load llama.rn once; return the cached promise on subsequent calls.
   * Used in dev mode to provide a fallback when Ollama is unreachable.
   * Silently no-ops if the model is not downloaded or llama.rn is unavailable
   * (the dynamic import throws in Expo Go, which is caught and ignored).
   */
  private _ensureLlamaRnLoaded(): Promise<void> {
    if (this._llamaRnLoadPromise) return this._llamaRnLoadPromise;
    this._llamaRnLoadPromise = (async () => {
      try {
        const info = await FileSystem.getInfoAsync(MODEL_PATH);
        if (!info.exists) {
          logger.info(TAG, 'llama.rn fallback skipped — model not downloaded');
          return;
        }
        const { initLlama } = await import('llama.rn');
        this.llm = await initLlama({
          model: MODEL_PATH,
          use_mlock: true,
          n_ctx: 1024,
          n_threads: 4,
        });
        logger.info(TAG, 'llama.rn loaded as offline fallback');
      } catch (err) {
        // Expected in Expo Go — native module not bundled. Silent failure.
        logger.warn(TAG, 'llama.rn offline fallback unavailable', { error: String(err) });
      }
    })();
    return this._llamaRnLoadPromise;
  }

  /**
   * Download the GGUF model to device storage, then initialize.
   * Call this from the SplashScreen when the model is not yet present.
   * @param onProgress receives (bytesWritten, bytesTotal) — both may be 0 initially
   */
  async downloadModel(
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    }

    const download = FileSystem.createDownloadResumable(
      MODEL_URL,
      MODEL_PATH,
      {},
      (progress) => {
        onProgress?.(
          progress.totalBytesWritten,
          progress.totalBytesExpectedToWrite,
        );
      },
    );

    await download.downloadAsync();
    logger.info(TAG, 'Model downloaded', { path: MODEL_PATH });

    // Reset so initialize() re-runs the file-exists check
    this.isReady = false;
    this.isLoading = false;
    await this.initialize();
  }

  /** True only after model file exists and llama.rn context is fully loaded. */
  isModelReady(): boolean {
    return this.isReady;
  }

  async isModelDownloaded(): Promise<boolean> {
    const info = await FileSystem.getInfoAsync(MODEL_PATH);
    return info.exists;
  }

  async isAvailable(): Promise<boolean> {
    return this.isReady;
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    if (!this.isReady) {
      const reason = IS_DEV
        ? 'Cannot reach Ollama. Check that Ollama is running and EXPO_PUBLIC_OLLAMA_URL is correct.'
        : 'The on-device AI model is not loaded. Please connect to the internet to use cloud AI.';
      throw new LLMUnavailableError(reason);
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

    logger.info(TAG, 'calling Ollama', { url: `${OLLAMA_URL}/api/chat`, model: OLLAMA_MODEL });

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
        const body = await response.text().catch(() => '');
        logger.error(TAG, 'Ollama HTTP error', { status: response.status, body });
        throw new Error(`Ollama HTTP ${response.status}: ${body}`);
      }

      const data = await response.json() as { message?: { content?: string } };
      const text = data.message?.content ?? '';
      logger.info(TAG, 'Ollama response received', { length: text.length });
      return text;
    } catch (err) {
      logger.error(TAG, 'Ollama call failed', { error: String(err), url: OLLAMA_URL });
      // If Ollama is unreachable, try the local model (works in dev client builds;
      // _ensureLlamaRnLoaded() was started at initialize() so this usually resolves instantly).
      await this._ensureLlamaRnLoaded();
      if (this.llm) {
        logger.info(TAG, 'Ollama unreachable — falling back to local llama.rn');
        return this._callLlamaRn(messages, systemPrompt);
      }
      throw new LLMUnavailableError(`Ollama unreachable: ${String(err)}`);
    }
  }

  private async _callLlamaRn(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    if (!this.llm) {
      throw new LLMUnavailableError('llama.rn context not initialized');
    }

    const prompt = formatChatMLPrompt(messages, systemPrompt);

    try {
      const result = await this.llm.completion({
        prompt,
        n_predict: MAX_TOKENS,
        temperature: TEMPERATURE,
        stop: ['<|im_end|>', '<|endoftext|>'],
      });

      return (result as { text: string }).text.trim();
    } catch (err) {
      throw new LLMUnavailableError(`llama.rn inference failed: ${String(err)}`);
    }
  }
}

export const slmAdapter = new SLMAdapter();
