// Local RAG engine — keyword-based search over the bundled WHO knowledge base.
//
// Why not @xenova/transformers (ONNX embedding)?
//   Hermes (React Native JS engine) has no WebAssembly support, so ONNX
//   inference always fails with "Property 'WebAssembly' doesn't exist".
//   Keyword scoring is pure JS, works offline, and is sufficient for
//   medical-term retrieval from a ~300-chunk WHO/NHS corpus.
//
// Index priority (highest first):
//   1. documentDirectory/knowledge_meta.json   (downloaded by KnowledgeBaseUpdateService)
//   2. bundled  apps/mobile/src/assets/knowledge/knowledge_meta.json
//
// Silent failure everywhere: if no index is found, query() returns [].
//
// Scoring — title-boosted BM25-style keyword overlap:
//
//   finalScore = contentScore + (titleScore × TITLE_WEIGHT)
//
//   contentScore = uniqueRootTermsMatchedInContent / totalRootTerms  → [0, 1]
//   titleScore   = uniqueRootTermsMatchedInTitle   / totalRootTerms  → [0, 1]
//   TITLE_WEIGHT = 3
//
//   "Root term" = the original query term.  Synonyms and spelling variants all
//   collapse back to their root so a match via any synonym counts as one hit,
//   never double-counted.
//
//   Result: an article whose title contains query terms ranks at most 4× higher
//   than one that only mentions them incidentally — which is exactly the
//   distinction between "Diarrhoea and vomiting" (primary topic) and
//   "Typhoid Fever" (diarrhea is a passing mention).
//
// Synonym expansion:
//   MEDICAL_SYNONYMS handles British/American spelling variants (diarrhea ↔
//   diarrhoea, haemorrhage ↔ hemorrhage) and common medical alternatives so
//   queries are spelling-agnostic.

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

// ── Stop words ─────────────────────────────────────────────────────────────────

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

// ── Medical synonym table ──────────────────────────────────────────────────────
// Keep symmetric: if A → B then B → A.
// Only add variants that are genuinely interchangeable in patient speech OR
// that appear in our article corpus under a different spelling.

const MEDICAL_SYNONYMS: Record<string, string[]> = {
  // British / American spelling
  'diarrhea':     ['diarrhoea'],
  'diarrhoea':    ['diarrhea'],
  'hemorrhage':   ['haemorrhage', 'bleeding'],
  'haemorrhage':  ['hemorrhage', 'bleeding'],
  'esophagus':    ['oesophagus'],
  'oesophagus':   ['esophagus'],

  // Bleeding / wounds
  'bleeding':     ['haemorrhage', 'hemorrhage'],
  'wound':        ['laceration', 'cut'],
  'laceration':   ['wound', 'cut'],

  // GI
  'vomit':        ['vomiting'],
  'vomiting':     ['vomit'],
  'nausea':       ['nauseous'],
  'nauseous':     ['nausea'],
  'stool':        ['diarrhoea', 'diarrhea'],
  'stools':       ['diarrhoea', 'diarrhea'],
  'dehydration':  ['dehydrated'],
  'dehydrated':   ['dehydration'],

  // Neurological
  'seizure':      ['convulsion', 'fit'],
  'convulsion':   ['seizure', 'fit'],
  'fit':          ['seizure', 'convulsion'],
  'unconscious':  ['unresponsive', 'fainted', 'collapse'],
  'unresponsive': ['unconscious'],
  'fainted':      ['unconscious'],

  // Respiratory
  'breathing':    ['breathe', 'respiratory'],
  'breathe':      ['breathing', 'respiratory'],
  'respiratory':  ['breathing', 'breathe'],

  // Musculoskeletal
  'fracture':     ['broken'],
  'broken':       ['fracture'],
  'crush':        ['crushed', 'trapped'],
  'crushed':      ['crush', 'trapped'],

  // Burns / chemical
  'burn':         ['burns', 'burning'],
  'burns':        ['burn', 'burning'],

  // Cardiovascular
  'cardiac':      ['heart'],
  'heart':        ['cardiac'],

  // Allergic
  'allergy':      ['anaphylaxis', 'allergic'],
  'allergic':     ['anaphylaxis', 'allergy'],
  'anaphylaxis':  ['allergic', 'allergy'],

  // Pain
  'pain':         ['ache', 'aches', 'painful'],
  'ache':         ['pain', 'painful'],

  // Fever
  'fever':        ['temperature', 'pyrexia'],
  'temperature':  ['fever'],

  // Bites / stings
  'bite':         ['bitten', 'sting', 'stings'],
  'bitten':       ['bite', 'sting'],
  'sting':        ['bite', 'bitten'],
  'snake':        ['venom', 'venomous'],
  'venom':        ['snake', 'venomous'],

  // Water / drowning
  'drowning':     ['drowned', 'submersion'],
  'drowned':      ['drowning', 'submersion'],

  // Electric
  'electric':     ['electrocution'],
  'electrocution':['electric', 'shock'],
  'shock':        ['electric', 'electrocution'],
};

// Title boost factor — an article whose title matches query terms ranks this
// many times higher than one that only mentions them in passing content.
const TITLE_WEIGHT = 3;

// ── Service ────────────────────────────────────────────────────────────────────

class LocalRAGService {
  private metadata: ChunkMetadata[] = [];
  private isLoaded = false;

  /**
   * Load the knowledge index.  Tries documentDirectory first (updated index
   * downloaded by KnowledgeBaseUpdateService), then falls back to the
   * baseline index bundled with the app.  Silent failure.
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
   * Search for chunks relevant to `symptomText` using title-boosted keyword
   * scoring with medical synonym expansion.  Returns up to `topK` results
   * with score > 0, sorted descending.  Returns [] if index is not loaded.
   */
  async query(symptomText: string, topK = 3): Promise<RAGResult[]> {
    if (!this.isLoaded || !Array.isArray(this.metadata) || this.metadata.length === 0) {
      return [];
    }
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
      if (!Array.isArray(meta) || meta.length === 0) return false;
      this.metadata = meta;
      console.log('[RAG] Loaded baseline index from bundled assets.');
      return true;
    } catch {
      return false;
    }
  }

  // ── Scoring helpers ───────────────────────────────────────────────────────────

  /** Tokenize text: lowercase, strip non-alpha, remove stop words, min length 3. */
  private _tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t));
  }

  /**
   * Expand rawTerms with medical synonyms.
   * Returns a deduplicated array containing the original terms plus all synonyms.
   */
  private _expandTerms(rawTerms: string[]): string[] {
    const expanded = new Set<string>(rawTerms);
    for (const term of rawTerms) {
      for (const syn of MEDICAL_SYNONYMS[term] ?? []) {
        expanded.add(syn);
      }
    }
    return Array.from(expanded);
  }

  /**
   * Given an expanded term, find which original query term (root) it belongs to.
   * This prevents double-counting when both a term and its synonym appear.
   */
  private _rootOf(expandedTerm: string, rawTerms: string[]): string {
    if (rawTerms.includes(expandedTerm)) return expandedTerm;
    for (const raw of rawTerms) {
      if ((MEDICAL_SYNONYMS[raw] ?? []).includes(expandedTerm)) return raw;
    }
    return expandedTerm;
  }

  // ── Core query ────────────────────────────────────────────────────────────────

  private _keywordQuery(text: string, topK: number): RAGResult[] {
    const rawTerms = this._tokenize(text);
    if (rawTerms.length === 0) return [];

    // Expand with spelling variants and medical synonyms
    const expandedTerms = this._expandTerms(rawTerms);

    const scored = this.metadata.map((chunk, index) => {
      const content = chunk.content.toLowerCase();
      const title   = (chunk.articleTitle ?? '').toLowerCase();

      // ── Content score ──────────────────────────────────────────────────────
      // Count unique root terms matched in the chunk content.
      // A term matched via synonym still counts as one hit (deduplicated by root).
      const contentRoots = new Set<string>();
      for (const term of expandedTerms) {
        if (content.includes(term)) {
          contentRoots.add(this._rootOf(term, rawTerms));
        }
      }
      const contentScore = contentRoots.size / rawTerms.length; // [0, 1]

      // ── Title score ────────────────────────────────────────────────────────
      // Same logic for the article title.  Multiplied by TITLE_WEIGHT so that
      // articles specifically about the queried condition rank above articles
      // that merely mention the symptoms in passing.
      const titleRoots = new Set<string>();
      for (const term of expandedTerms) {
        if (title.includes(term)) {
          titleRoots.add(this._rootOf(term, rawTerms));
        }
      }
      const titleScore = (titleRoots.size / rawTerms.length) * TITLE_WEIGHT; // [0, TITLE_WEIGHT]

      return { score: contentScore + titleScore, index };
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
