import { getSession } from "next-auth/react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  let authToken = token;
  if (!authToken) {
    const session = await getSession();
    authToken = session?.user?.access_token;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }

  return res.json() as Promise<T>;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: { id: string; email: string; role: string; org_id: string; org_name: string; org_type: string };
}

export interface RegisterResponse { org_id: string; message: string }

export interface CaseListItem {
  id: string;
  triage_level: "RED" | "AMBER" | "GREEN";
  status: "PENDING" | "ACKNOWLEDGED" | "RESOLVED" | "CLOSED";
  chief_complaint: string;
  triage_reason: string;
  lat: number;
  lng: number;
  severity: number;
  received_at: string;
  has_soap: boolean;
  claimed_by_org_id: string | null;
}

export interface SoapReport {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  generated_at: string;
  model_used: string;
}

export interface CaseDetail extends CaseListItem {
  symptoms: string[];
  conversation_summary: string;
  patient_name: string | null;
  patient_phone: string | null;
  claimed_at: string | null;
  resolved_at: string | null;
  soap_report: SoapReport | null;
}

export interface CaseListResponse { total: number; limit: number; offset: number; cases: CaseListItem[] }
export interface ClaimResponse { case_id: string; status: string; claimed_by_org_id: string; claimed_at: string }
export interface ResolveResponse { case_id: string; status: string; resolved_at: string }
export interface SummaryResponse { period_days: number; total_cases: number; critical_cases: number; avg_response_time_minutes: number; resolution_rate_percent: number; cases_last_24h: number; pending_cases: number }
export interface TimeseriesResponse { period_days: number; series: Array<{ date: string; RED: number; AMBER: number; GREEN: number }> }
export interface SymptomsResponse { period_days: number; symptoms: Array<{ symptom: string; count: number }> }
export interface GeoResponse { period_days: number; points: Array<{ lat: number; lng: number; triage_level: string; weight: number }> }
export interface VersionResponse { version: number; document_count: number; chunk_count: number; updated_at: string }
export interface QueryResponse { results: Array<{ content: string; article_title: string; article_url: string; article_author: string; article_source: string; relevance_score: number }> }
export interface DocumentItem { id: string; title: string; filename: string; file_size_bytes: number; status: string; chunk_count: number | null; uploaded_by_email: string; uploaded_at: string; processed_at: string | null; error_message: string | null }
export interface DocumentListResponse { documents: DocumentItem[]; kb_version: number; total_active_chunks: number }
export interface DocumentResponse { id: string; title: string; status: string; message?: string }
export interface DeleteResponse { deleted_id: string; new_kb_version: number; message: string }
export interface StatsResponse { kb_version: number; active_documents: number; total_chunks: number; index_size_mb: number; last_updated: string; top_retrieved_documents: Array<{ id: string; title: string; retrievals_7d: number }> }
export interface OrgItem { id: string; name: string; type: string; status: string; access_code: string; user_count: number; case_count: number; created_at: string }
export interface OrgListResponse { organizations: OrgItem[] }
export interface OrgResponse { org_id: string; status: string; message?: string }
export interface HealthResponse { api: string; postgres: string; redis: string; celery_workers: number; checked_at: string }
export interface QueueResponse { soap_generation: { pending: number; active: number; failed: number }; document_ingestion: { pending: number; active: number; failed: number }; checked_at: string }

// ── Auth ─────────────────────────────────────────────────────────────────────

export const loginUser = (email: string, password: string) =>
  request<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const registerOrg = (data: { org_name: string; org_type: string; email: string; password: string; access_code: string }) =>
  request<RegisterResponse>("/api/v1/auth/register", { method: "POST", body: JSON.stringify(data) });

// ── Cases ─────────────────────────────────────────────────────────────────────

export const getCases = (filters?: { triage_level?: string; status?: string; limit?: number; offset?: number; sort?: string }) => {
  const params = new URLSearchParams();
  if (filters?.triage_level) params.set("triage_level", filters.triage_level);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  if (filters?.sort) params.set("sort", filters.sort);
  return request<CaseListResponse>(`/api/v1/cases?${params.toString()}`);
};

export const getCaseById = (id: string) =>
  request<CaseDetail>(`/api/v1/cases/${id}`);

export const claimCase = (id: string) =>
  request<ClaimResponse>(`/api/v1/cases/${id}/claim`, { method: "PATCH" });

export const resolveCase = (id: string, data: { outcome: string; resolution_notes?: string }) =>
  request<ResolveResponse>(`/api/v1/cases/${id}/resolve`, { method: "PATCH", body: JSON.stringify(data) });

// ── Analytics ────────────────────────────────────────────────────────────────

export const getAnalyticsSummary = (days?: number) =>
  request<SummaryResponse>(`/api/v1/analytics/summary${days ? `?days=${days}` : ""}`);

export const getTimeseries = (days?: number) =>
  request<TimeseriesResponse>(`/api/v1/analytics/timeseries${days ? `?days=${days}` : ""}`);

export const getSymptoms = (days?: number) =>
  request<SymptomsResponse>(`/api/v1/analytics/symptoms${days ? `?days=${days}` : ""}`);

export const getGeoData = (days?: number) =>
  request<GeoResponse>(`/api/v1/analytics/geo${days ? `?days=${days}` : ""}`);

// ── Knowledge (public) ────────────────────────────────────────────────────────

export const getKBVersion = () =>
  request<VersionResponse>("/api/v1/knowledge/version");

export const queryKnowledge = (query: string, topK = 3) =>
  request<QueryResponse>("/api/v1/knowledge/query", {
    method: "POST",
    body: JSON.stringify({ query, top_k: topK }),
  });

// ── Admin — Knowledge ─────────────────────────────────────────────────────────

export const getAdminDocuments = () =>
  request<DocumentListResponse>("/api/v1/admin/knowledge/documents");

export const uploadDocument = (formData: FormData) =>
  getSession().then((session) =>
    fetch(`${BASE_URL}/api/v1/admin/knowledge/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.user?.access_token}` },
      body: formData,
    }).then((r) => r.json() as Promise<DocumentResponse>)
  );

export const getDocumentById = (id: string) =>
  request<DocumentItem>(`/api/v1/admin/knowledge/documents/${id}`);

export const archiveDocument = (id: string) =>
  request<DocumentResponse>(`/api/v1/admin/knowledge/documents/${id}/archive`, { method: "PATCH" });

export const reprocessDocument = (id: string) =>
  request<DocumentResponse>(`/api/v1/admin/knowledge/documents/${id}/reprocess`, { method: "PATCH" });

export const deleteDocument = (id: string) =>
  request<DeleteResponse>(`/api/v1/admin/knowledge/documents/${id}`, { method: "DELETE" });

export const getKBStats = () =>
  request<StatsResponse>("/api/v1/admin/knowledge/stats");

// ── Admin — Organizations ─────────────────────────────────────────────────────

export const getOrganizations = () =>
  request<OrgListResponse>("/api/v1/admin/organizations");

export const approveOrg = (id: string) =>
  request<OrgResponse>(`/api/v1/admin/organizations/${id}/approve`, { method: "PATCH" });

export const suspendOrg = (id: string, reason: string) =>
  request<OrgResponse>(`/api/v1/admin/organizations/${id}/suspend`, {
    method: "PATCH",
    body: JSON.stringify({ reason }),
  });

// ── Admin — System ────────────────────────────────────────────────────────────

export const getSystemHealth = () =>
  request<HealthResponse>("/api/v1/admin/system/health");

export const getQueueStats = () =>
  request<QueueResponse>("/api/v1/admin/system/queue");
