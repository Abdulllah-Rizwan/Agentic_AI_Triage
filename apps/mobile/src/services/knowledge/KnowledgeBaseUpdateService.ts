import {
  documentDirectory,
  downloadAsync,
} from 'expo-file-system/legacy';
import { networkStore } from '../../store/networkStore';
import { getMetadata, setMetadata } from '../../db/queries';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const LOCAL_VERSION_KEY = 'kb_local_version';
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

      const versionData = (await response.json()) as {
        version: number;
        chunk_count?: number;
        document_count?: number;
      };
      const serverVersion = versionData.version;
      const chunkCount = versionData.chunk_count ?? 0;

      // No documents have been indexed yet — skip download entirely.
      // (KnowledgeBaseVersion defaults to version=1 even on an empty server.)
      if (chunkCount === 0) {
        console.log('[KnowledgeBase] No chunks indexed on server — skipping download.');
        return;
      }

      const localVersion = await this.getCurrentVersion();
      if (serverVersion <= localVersion) {
        console.log(`[KnowledgeBase] Up to date: v${localVersion}`);
        return;
      }

      // Download the metadata JSON (text chunks + attribution) from /exports/.
      // LocalRAG.ts uses keyword search — no embeddings file needed.
      const metaResult = await downloadAsync(
        `${API_BASE_URL}/exports/${META_FILENAME}`,
        `${documentDirectory}${META_FILENAME}`,
      );

      if (metaResult.status !== 200) {
        console.warn('[KnowledgeBase] Metadata download failed (status:', metaResult.status, ')');
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
