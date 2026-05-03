// Local RAG engine — searches the bundled WHO FAISS knowledge base.
// Falls back gracefully if the index has not been built yet.

export interface RAGResult {
  content: string;
  articleTitle: string | null;
  articleUrl: string | null;
  score: number;
}

export async function queryKnowledgeBase(
  _symptomText: string,
  _topK: number = 3,
): Promise<RAGResult[]> {
  // Full implementation deferred — FAISS JS query requires the index
  // built by docs/knowledge-base/build_baseline_index.py and loaded
  // into the app's document directory.
  // For now returns empty so callers can proceed without crashing.
  return [];
}
