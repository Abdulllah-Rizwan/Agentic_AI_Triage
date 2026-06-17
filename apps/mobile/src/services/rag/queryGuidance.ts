// Network-aware RAG routing.
//
// queryGuidance(text)          — keyword query, used for emergency-bar RAG context
//                                 FULL: server pgvector, OFFLINE: local BM25
//
// routeGuidance(summary, lvl) — LLM-based disease routing, used for post-triage guidance
//                                 FULL: POST /route (LLM picks article → action chunks)
//                                 OFFLINE: local BM25 over conversationSummary + section pref
//
// Both return the same RAGResult[] shape.

import { networkStore } from '../../store/networkStore';
import { localRAG, type RAGResult } from './LocalRAG';
import { deviceTokenService } from '../transmission/DeviceTokenService';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

// Generic first-aid text shown when no article can be matched offline
const GENERIC_FALLBACK =
  'Rest and stay hydrated — drink clean water or ORS ' +
  '(1 litre water + 6 teaspoons sugar + ½ teaspoon salt). ' +
  'Give paracetamol for fever or pain. ' +
  'Monitor symptoms closely. If your condition worsens, ' +
  'seek medical care at the nearest health facility. ' +
  'Call Rescue 1122 or Edhi Foundation 115 if you feel your situation is serious.';

interface ServerQueryItem {
  content: string;
  article_title: string | null;
  article_source: string | null;
  section_type: string | null;
  relevance_score: number;
}

interface ServerQueryResponse {
  results: ServerQueryItem[];
}

interface ServerRouteResponse {
  matched_topics: string[];
  results: ServerQueryItem[];
  fallback: boolean;
}

// ── queryGuidance — keyword search (unchanged public API) ─────────────────────

/**
 * Network-aware keyword query for rapid guidance lookup.
 * Used by SymptomCollectorAgent for emergency-bar RAG context during the interview.
 *
 * @param queryText  Symptom keyword or trigger phrase
 * @param topK       Max results (default 1)
 */
export async function queryGuidance(queryText: string, topK = 1): Promise<RAGResult[]> {
  const mode = networkStore.getState().mode;
  if (mode === 'FULL') {
    return _queryServer(queryText, topK);
  }
  return localRAG.query(queryText, topK);
}

// ── routeGuidance — LLM disease routing for post-triage guidance ──────────────

/**
 * LLM-based disease routing for post-triage patient guidance.
 * Used by ChatScreen._handlePostTriage and TriageResultScreen.
 *
 * FULL mode:  Sends conversation summary to /route. The server calls the LLM
 *             to identify the matching article and returns its action-type chunks.
 * OFFLINE:    Falls back to local BM25 over the full conversation summary,
 *             preferring action-type chunks.
 * Fallback:   If no article matches, returns a generic first-aid message.
 *
 * @param conversationSummary  Full conversation summary from MedicalFeatureVector
 * @param triageLevel          RED | AMBER | GREEN
 */
export async function routeGuidance(
  conversationSummary: string,
  triageLevel: string,
): Promise<RAGResult[]> {
  const mode = networkStore.getState().mode;

  if (mode === 'FULL') {
    const result = await _routeServer(conversationSummary, triageLevel);
    if (result.length > 0) return result;
  }

  // Offline path: BM25 over the full summary (richer than a single keyword)
  const localResults = await localRAG.query(conversationSummary, 1);
  if (localResults.length > 0 && localResults[0]!.score > 0.1) {
    return localResults;
  }

  // Nothing found anywhere — return generic guidance
  return [{
    content: GENERIC_FALLBACK,
    articleTitle: null,
    articleSource: 'MediReach First Aid',
    sectionType: 'action',
    score: 1.0,
  }];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _getToken(): Promise<string | null> {
  try {
    return await deviceTokenService.getDeviceToken();
  } catch {
    return null;
  }
}

// How long to wait for a server response before falling back to local RAG.
// A dead server causes fetch to hang until the OS TCP timeout (~75 s).
// 8 seconds is enough for a healthy server; shorter means faster fallback
// to local BM25 / generic guidance when the server is unreachable.
const SERVER_TIMEOUT_MS = 8_000;

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id),
  );
}

async function _queryServer(queryText: string, topK: number): Promise<RAGResult[]> {
  try {
    const token = await _getToken();
    if (!token) return localRAG.query(queryText, topK);

    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/knowledge/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: queryText, top_k: topK }),
    });

    if (!response.ok) return localRAG.query(queryText, topK);

    const body = (await response.json()) as ServerQueryResponse;
    return _mapServerItems(body.results ?? []);
  } catch {
    return localRAG.query(queryText, topK);
  }
}

async function _routeServer(
  conversationSummary: string,
  triageLevel: string,
): Promise<RAGResult[]> {
  try {
    const token = await _getToken();
    if (!token) return [];

    const response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/knowledge/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversation_summary: conversationSummary,
        triage_level: triageLevel,
      }),
    });

    if (!response.ok) return [];

    const body = (await response.json()) as ServerRouteResponse;

    // If the server returned generic fallback, use our own (already in the
    // offline path above so we don't double-show it)
    if (body.fallback) return [];

    return _mapServerItems(body.results ?? []);
  } catch {
    return [];
  }
}

function _mapServerItems(items: ServerQueryItem[]): RAGResult[] {
  return items.map((item) => ({
    content:       item.content,
    articleTitle:  item.article_title,
    articleSource: item.article_source,
    sectionType:   item.section_type ?? undefined,
    score:         item.relevance_score,
  }));
}
