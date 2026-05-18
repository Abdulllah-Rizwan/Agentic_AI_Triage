// Network-aware RAG routing.
// FULL (WiFi/4G)          → server-side pgvector semantic search
// DEGRADED / OFFLINE      → LocalRAG BM25 keyword search (on-device)
//
// Returns the same RAGResult[] shape in both paths so callers are unaware of
// which backend was used.

import { networkStore } from '../../store/networkStore';
import { localRAG, type RAGResult } from './LocalRAG';
import { deviceTokenService } from '../transmission/DeviceTokenService';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

interface ServerRAGItem {
  content: string;
  article_title: string | null;
  article_source: string | null;
  relevance_score: number;
}

interface ServerRAGResponse {
  results: ServerRAGItem[];
}

/**
 * Query the knowledge base with automatic network-tier routing.
 *
 * @param queryText  Natural-language query (symptom, trigger keyword, etc.)
 * @param topK       Max number of results to return (default 1)
 * @returns          Up to topK RAGResult items, or [] on any failure
 */
export async function queryGuidance(queryText: string, topK = 1): Promise<RAGResult[]> {
  const mode = networkStore.getState().mode;

  if (mode === 'FULL') {
    return _queryServer(queryText, topK);
  }
  return localRAG.query(queryText, topK);
}

async function _queryServer(queryText: string, topK: number): Promise<RAGResult[]> {
  try {
    let token: string;
    try {
      token = await deviceTokenService.getDeviceToken();
    } catch {
      // Token fetch failed (server unreachable) — fall back to local
      return localRAG.query(queryText, topK);
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/knowledge/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: queryText, top_k: topK }),
    });

    if (!response.ok) {
      return localRAG.query(queryText, topK);
    }

    const body = (await response.json()) as ServerRAGResponse;
    const items = body.results ?? [];

    return items.map((item) => ({
      content:       item.content,
      articleTitle:  item.article_title,
      articleSource: item.article_source,
      score:         item.relevance_score,
    }));
  } catch {
    // Network error or parse error — silently fall back to LocalRAG
    return localRAG.query(queryText, topK);
  }
}
