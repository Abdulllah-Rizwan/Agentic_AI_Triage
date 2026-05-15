// Local RAG engine — keyword-based search over the bundled WHO knowledge base.
//
// Why not @xenova/transformers (ONNX embedding)?
//   Hermes (React Native JS engine) has no WebAssembly support, so ONNX
//   inference always fails with "Property 'WebAssembly' doesn't exist".
//   Keyword BM25-style scoring is pure JS, works offline, and is sufficient
//   for medical-term retrieval from a ~300-chunk WHO corpus.
//
// Index priority (highest first):
//   1. documentDirectory/knowledge_meta.json   (downloaded by KnowledgeBaseUpdateService)
//   2. bundled  apps/mobile/src/assets/knowledge/knowledge_meta.json
//
// Silent failure everywhere: if no index is found, query() returns [].

import {
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
} from 'expo-file-system/legacy';

// ── Public types ───────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  content: string;
  articleTitle: string | null;
  articleUrl: string | null;
  articleAuthor: string | null;
  articleSource: string | null;
}

export interface RAGResult {
  content: string;
  articleTitle: string | null;
  articleSource: string | null;
  score: number;
}

// ── Stop words (filtered from query before scoring) ───────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might',
  'this','that','these','those','it','its','they','them','their',
  'what','which','who','how','when','where','why','not','no','yes',
  'can','all','any','some','more','most','other','also','if','then',
  'than','there','here','very','just','about','from','up','out','as',
  'into','by','my','i','you','we','he','she','am','so','get','got',
  'feel','feeling','had','has','have','having','been','are','were',
]);

// ── Service ────────────────────────────────────────────────────────────────────

class LocalRAGService {
  private metadata: ChunkMetadata[] = [];
  private isLoaded = false;

  /**
   * Load the index files.  Tries documentDirectory first, then bundled assets.
   * Must be called once at app startup (called by App.tsx after DB init).
   * Silent failure — sets isLoaded = false if no index is found.
   */
  async initialize(): Promise<void> {
    try {
      const loaded =
        (await this._loadFromDocumentDirectory()) ||
        (await this._loadFromBundledAssets());

      if (!loaded) {
        console.warn('[RAG] No knowledge index found — queries will return empty.');
        return;
      }

      this.isLoaded = true;
      console.log(`[RAG] Ready — ${this.metadata.length} chunks loaded.`);
    } catch (err) {
      console.warn('[RAG] Initialization failed silently:', err);
    }
  }

  /**
   * Search for chunks relevant to `symptomText` using BM25-inspired keyword
   * scoring.  Returns up to `topK` results with at least one term match,
   * sorted descending by score.  Returns [] if the index is not loaded.
   */
  async query(symptomText: string, topK = 3): Promise<RAGResult[]> {
    if (!this.isLoaded || !Array.isArray(this.metadata) || this.metadata.length === 0) return [];

    try {
      return this._keywordQuery(symptomText, topK);
    } catch (err) {
      console.warn('[RAG] Query failed silently:', err);
      return [];
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  private async _loadFromDocumentDirectory(): Promise<boolean> {
    try {
      const metaPath = `${documentDirectory}knowledge_meta.json`;
      const info = await getInfoAsync(metaPath);
      if (!info.exists) return false;

      const parsed = JSON.parse(await readAsStringAsync(metaPath));

      // Guard: downloadAsync writes the error response body (e.g. {"detail":"…"})
      // when the server returns 404 — that produces a plain object, not an array.
      // Reject anything that isn't a non-empty ChunkMetadata array.
      if (!Array.isArray(parsed) || parsed.length === 0) return false;

      this.metadata = parsed as ChunkMetadata[];
      console.log('[RAG] Loaded updated index from documentDirectory.');
      return true;
    } catch {
      return false;
    }
  }

  private async _loadFromBundledAssets(): Promise<boolean> {
    try {
      // Metro resolves JSON requires at bundle time — no runtime IO needed.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const meta: ChunkMetadata[] = require('../../assets/knowledge/knowledge_meta.json');
      this.metadata = meta;
      console.log('[RAG] Loaded baseline index from bundled assets.');
      return true;
    } catch {
      return false;
    }
  }

  // ── Keyword search ────────────────────────────────────────────────────────────

  private _keywordQuery(text: string, topK: number): RAGResult[] {
    const terms = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    if (terms.length === 0) return [];

    const scored = this.metadata.map((chunk, index) => {
      const content = chunk.content.toLowerCase();
      let hits = 0;
      for (const term of terms) {
        if (content.includes(term)) hits++;
      }
      return { score: hits / terms.length, index };
    });

    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ score, index }) => ({
        content:       this.metadata[index]!.content,
        articleTitle:  this.metadata[index]!.articleTitle,
        articleSource: this.metadata[index]!.articleSource,
        score:         Math.round(score * 10000) / 10000,
      }));
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export const localRAG = new LocalRAGService();

/** Named export — backward-compatible with SymptomCollectorAgent. */
export async function queryKnowledgeBase(
  symptomText: string,
  topK = 3,
): Promise<RAGResult[]> {
  return localRAG.query(symptomText, topK);
}
