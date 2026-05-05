import {
  documentDirectory,
  downloadAsync,
} from 'expo-file-system/legacy';
import { networkStore } from '../../store/networkStore';
import { getMetadata, setMetadata } from '../../db/queries';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const LOCAL_VERSION_KEY = 'kb_local_version';
const EMB_FILENAME  = 'knowledge_embeddings.json';
const META_FILENAME = 'knowledge_meta.json';

class KnowledgeBaseUpdateService {
  /**
   * Silently checks whether a newer knowledge base index is available on the
   * server and downloads it if so.  Must NEVER throw — all errors are warnings.
   */
  async checkAndUpdate(): Promise<void> {
    try {
      const mode = networkStore.getState().mode;
      if (mode === 'OFFLINE') return;

      const response = await fetch(`${API_BASE_URL}/api/v1/knowledge/version`);
      if (!response.ok) return;

      const { version: serverVersion } = (await response.json()) as {
        version: number;
      };

      const localVersion = await this.getCurrentVersion();
      if (serverVersion <= localVersion) {
        console.log(`[KnowledgeBase] Up to date: v${localVersion}`);
        return;
      }

      // Download both JSON files served as static assets from /exports/
      // LocalRAG.ts needs knowledge_embeddings.json + knowledge_meta.json;
      // it uses pure-JS cosine similarity and cannot read native FAISS binaries.
      const [embResult, metaResult] = await Promise.all([
        downloadAsync(
          `${API_BASE_URL}/exports/${EMB_FILENAME}`,
          `${documentDirectory}${EMB_FILENAME}`,
        ),
        downloadAsync(
          `${API_BASE_URL}/exports/${META_FILENAME}`,
          `${documentDirectory}${META_FILENAME}`,
        ),
      ]);

      if (embResult.status !== 200) {
        console.warn('[KnowledgeBase] Embeddings download failed:', embResult.status);
        return;
      }
      if (metaResult.status !== 200) {
        console.warn('[KnowledgeBase] Metadata download failed:', metaResult.status);
        return;
      }

      await setMetadata(LOCAL_VERSION_KEY, serverVersion.toString());
      console.log(
        `[KnowledgeBase] Updated: v${localVersion} → v${serverVersion}`,
      );
    } catch (err) {
      console.warn('[KnowledgeBase] Silent update failure:', err);
    }
  }

  /** Returns the locally cached knowledge base version (0 if never synced). */
  async getCurrentVersion(): Promise<number> {
    const str = await getMetadata(LOCAL_VERSION_KEY);
    return str ? parseInt(str, 10) : 0;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const knowledgeBaseUpdateService = new KnowledgeBaseUpdateService();

/** Named function export — keeps App.tsx import unchanged. */
export async function checkAndUpdateKnowledgeBase(): Promise<void> {
  return knowledgeBaseUpdateService.checkAndUpdate();
}
