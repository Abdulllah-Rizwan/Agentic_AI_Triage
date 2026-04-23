# API_ROUTES.md — Agentic AI Triage Complete Endpoint Specification

This file is the authoritative reference for every API endpoint. Claude Code reads this before implementing any route. Every endpoint is defined with: authentication required, request format, success response, and error responses.

**Base URL:** `http://localhost:3001` (development) / `https://api.medireach.app` (production)

**Auth header format:** `Authorization: Bearer <token>`

**Standard error response shape (all errors):**
```json
{ "detail": "Human readable error message" }
```

---

## Authentication Types

| Type | How to get it | Used by | Expiry |
|------|--------------|---------|--------|
| `dashboard_jwt` | `POST /auth/login` | Dashboard users (browser) | 15 min (refresh token: 7 days) |
| `device_jwt` | `POST /auth/device-register` | Mobile app | 30 days |
| none | — | Public endpoints | — |

---

## 1. Auth Routes — `/api/v1/auth`

---

### `POST /api/v1/auth/register`
Register a new organization and its first admin user. The org starts in `PENDING_APPROVAL` status and cannot log in until a system admin approves it.

**Auth required:** None

**Request body:**
```json
{
  "org_name": "Aga Khan Health Service",
  "org_type": "HOSPITAL",
  "email": "admin@akhs.org",
  "password": "SecurePass123!",
  "access_code": "AKHS2024"
}
```

| Field | Type | Validation |
|-------|------|-----------|
| `org_name` | string | 2–100 chars |
| `org_type` | enum | `NGO` \| `HOSPITAL` \| `GOVT` \| `RELIEF_CAMP` |
| `email` | string | valid email, unique across all users |
| `password` | string | min 8 chars |
| `access_code` | string | 4–20 chars, unique across all orgs |

**Success `201`:**
```json
{
  "org_id": "uuid",
  "message": "Registration submitted. Awaiting admin approval before you can log in."
}
```

**Errors:**
- `409` — email or access_code already taken
- `422` — validation failure

---

### `POST /api/v1/auth/login`
Dashboard user login. Returns a short-lived access token and a long-lived refresh token.

**Auth required:** None

**Request body:**
```json
{
  "email": "admin@akhs.org",
  "password": "SecurePass123!"
}
```

**Success `200`:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "email": "admin@akhs.org",
    "role": "RESPONDER",
    "org_id": "uuid",
    "org_name": "Aga Khan Health Service",
    "org_type": "HOSPITAL"
  }
}
```

**Errors:**
- `401` — wrong email or password
- `403` — org status is `PENDING_APPROVAL` or `SUSPENDED` (message differs for each)

---

### `POST /api/v1/auth/refresh`
Exchange a valid refresh token for a new access token.

**Auth required:** None

**Request body:**
```json
{ "refresh_token": "eyJ..." }
```

**Success `200`:**
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

**Errors:**
- `401` — refresh token expired or invalid

---

### `POST /api/v1/auth/device-register`
Mobile app calls this on first launch to receive a device-scoped JWT. This token only has permission to call `POST /cases/ingest`. It cannot access dashboard routes.

**Auth required:** None

**Request body:**
```json
{
  "device_id": "android-uuid-abc123",
  "device_model": "Samsung Galaxy A32",
  "app_version": "1.0.0"
}
```

**Success `200`:**
```json
{
  "device_token": "eyJ...",
  "expires_in_days": 30
}
```

---

## 2. Case Routes — `/api/v1/cases`

---

### `POST /api/v1/cases/ingest`
Receive a triage report from a mobile device. Body is a raw protobuf binary (`LeanPayload`), not JSON.

**Auth required:** `device_jwt`

**Request:**
- `Content-Type: application/octet-stream`
- Body: serialized `LeanPayload` protobuf bytes (see `proto/SCHEMA.md`)
- Max body size: 10KB

**Success `202`:**
```json
{
  "case_id": "device-generated-uuid",
  "status": "QUEUED",
  "message": "Case received. SOAP report generating."
}
```

**Duplicate `202`** (idempotent — same case_id submitted again):
```json
{
  "case_id": "device-generated-uuid",
  "status": "DUPLICATE",
  "message": "Already received"
}
```

**Errors:**
- `413` — payload exceeds 10KB
- `400` — protobuf parse failure
- `401` — missing or invalid device token

**Side effects:**
- Saves `Case` to database
- Enqueues `generate_soap_task` (Celery) if triage is RED or AMBER
- Runs triage audit agent synchronously if `network_mode == "FULL"`
- Emits `case:new` Socket.IO event to all dashboard clients of the relevant org's geographic zone
- If no org is assigned yet, broadcasts to all connected dashboard clients

---

### `GET /api/v1/cases`
List cases for the authenticated user's organization. Supports filtering and pagination.

**Auth required:** `dashboard_jwt` (any role)

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `triage_level` | string | all | Comma-separated: `RED`, `AMBER`, `GREEN` |
| `status` | string | `PENDING,ACKNOWLEDGED` | Comma-separated case statuses |
| `limit` | int | 50 | Max results per page (max 100) |
| `offset` | int | 0 | Pagination offset |
| `sort` | string | `received_at:desc` | `received_at:desc\|asc` or `severity:desc` |

**Success `200`:**
```json
{
  "total": 142,
  "limit": 50,
  "offset": 0,
  "cases": [
    {
      "id": "case-uuid",
      "triage_level": "RED",
      "status": "PENDING",
      "chief_complaint": "Severe chest pain with difficulty breathing",
      "triage_reason": "Keyword match: chest pain, difficulty breathing; severity 9",
      "lat": 24.8607,
      "lng": 67.0011,
      "severity": 9,
      "received_at": "2024-01-15T10:30:00Z",
      "has_soap": true,
      "claimed_by_org_id": null
    }
  ]
}
```

---

### `GET /api/v1/cases/{case_id}`
Full case detail including SOAP report if generated.

**Auth required:** `dashboard_jwt` (any role)

**Success `200`:**
```json
{
  "id": "case-uuid",
  "triage_level": "RED",
  "status": "ACKNOWLEDGED",
  "chief_complaint": "Severe chest pain with difficulty breathing",
  "triage_reason": "Keyword match: chest pain, difficulty breathing; severity 9",
  "symptoms": ["chest pain", "shortness of breath", "left arm numbness"],
  "severity": 9,
  "lat": 24.8607,
  "lng": 67.0011,
  "patient_name": "Ahmed Khan",
  "patient_phone": "+92-300-1234567",
  "received_at": "2024-01-15T10:30:00Z",
  "claimed_at": "2024-01-15T10:32:00Z",
  "claimed_by_org_id": "org-uuid",
  "soap_report": {
    "subjective": "55-year-old male presenting with...",
    "objective": "Self-reported field assessment only...",
    "assessment": "Clinical presentation consistent with ACS...",
    "plan": "1. IMMEDIATE transport...",
    "generated_at": "2024-01-15T10:31:05Z",
    "model_used": "gemini-2.0-flash"
  }
}
```

**Notes:**
- `soap_report` is `null` if still generating or if triage was GREEN
- `patient_name` and `patient_phone` are only included for RESPONDER and ADMIN roles; VIEWER receives `null` for these fields

**Errors:**
- `404` — case not found or belongs to different org

---

### `PATCH /api/v1/cases/{case_id}/claim`
Responder claims a case, triggering a push notification to the patient.

**Auth required:** `dashboard_jwt` (RESPONDER or ADMIN)

**Request body:** None (the claiming org is derived from the JWT)

**Success `200`:**
```json
{
  "case_id": "case-uuid",
  "status": "ACKNOWLEDGED",
  "claimed_by_org_id": "org-uuid",
  "claimed_at": "2024-01-15T10:32:00Z"
}
```

**Errors:**
- `409` — case already claimed by another org
- `404` — case not found

**Side effects:**
- Sets `case.status = ACKNOWLEDGED`
- Sets `case.claimed_by_org_id` and `case.claimed_at`
- Sends FCM/APNs push notification to patient device: `"Help is on the way. [OrgName] has been dispatched to your location."`
- Emits `case:claimed` Socket.IO event to all dashboard clients

---

### `PATCH /api/v1/cases/{case_id}/resolve`
Mark a case as resolved after assistance has been provided.

**Auth required:** `dashboard_jwt` (RESPONDER or ADMIN)

**Request body:**
```json
{
  "outcome": "Patient transported to Aga Khan Hospital. Stable condition.",
  "resolution_notes": "Administered aspirin 300mg on site."
}
```

| Field | Type | Required |
|-------|------|----------|
| `outcome` | string | Yes — short outcome summary |
| `resolution_notes` | string | No |

**Success `200`:**
```json
{
  "case_id": "case-uuid",
  "status": "RESOLVED",
  "resolved_at": "2024-01-15T11:45:00Z"
}
```

**Errors:**
- `409` — case is not in ACKNOWLEDGED status (cannot resolve a PENDING case)
- `403` — can only resolve cases claimed by your own org (unless ADMIN)

---

## 3. Analytics Routes — `/api/v1/analytics`

All analytics routes require `dashboard_jwt` (any role). All accept an optional `?days=7` query param (default 7, max 90) to control the time window.

---

### `GET /api/v1/analytics/summary`
KPI card data.

**Success `200`:**
```json
{
  "period_days": 7,
  "total_cases": 284,
  "critical_cases": 47,
  "avg_response_time_minutes": 12.4,
  "resolution_rate_percent": 78.2,
  "cases_last_24h": 31,
  "pending_cases": 8
}
```

---

### `GET /api/v1/analytics/timeseries`
Cases grouped by day and triage level for the line chart.

**Success `200`:**
```json
{
  "period_days": 7,
  "series": [
    {
      "date": "2024-01-09",
      "RED": 5,
      "AMBER": 12,
      "GREEN": 8
    },
    {
      "date": "2024-01-10",
      "RED": 3,
      "AMBER": 9,
      "GREEN": 14
    }
  ]
}
```

---

### `GET /api/v1/analytics/symptoms`
Top symptoms by frequency for the bar chart.

**Success `200`:**
```json
{
  "period_days": 7,
  "symptoms": [
    { "symptom": "chest pain", "count": 47 },
    { "symptom": "difficulty breathing", "count": 39 },
    { "symptom": "fracture", "count": 28 }
  ]
}
```

---

### `GET /api/v1/analytics/geo`
GPS coordinates of all cases for the heatmap. Returns only lat/lng/triage_level — no patient PII.

**Success `200`:**
```json
{
  "period_days": 7,
  "points": [
    { "lat": 24.8607, "lng": 67.0011, "triage_level": "RED", "weight": 3 },
    { "lat": 24.8521, "lng": 67.0143, "triage_level": "AMBER", "weight": 1 }
  ]
}
```

`weight` is 3 for RED, 2 for AMBER, 1 for GREEN — used by the Leaflet heatmap layer for intensity.

---

## 4. Knowledge Base Routes — `/api/v1/knowledge`

Public routes used by the mobile app. No authentication required (the FAISS index contains no PII).

---

### `GET /api/v1/knowledge/version`
Mobile app calls this on launch to check if its local knowledge base is outdated.

**Auth required:** None

**Success `200`:**
```json
{
  "version": 7,
  "document_count": 4,
  "chunk_count": 1247,
  "updated_at": "2024-01-15T08:00:00Z"
}
```

---

### `GET /api/v1/knowledge/index`
Download the latest FAISS index binary file. Mobile app downloads this when its local version is lower than the server version.

**Auth required:** None

**Success `200`:**
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename="knowledge_index.faiss"`
- Body: raw FAISS index binary

**Errors:**
- `503` — no index has been built yet (no documents uploaded)

---

### `POST /api/v1/knowledge/query`
Server-side RAG query. Called by the cloud conversation agent (online mode only) to retrieve relevant medical guidance chunks.

**Auth required:** `device_jwt`

**Request body:**
```json
{
  "query": "severe chest pain radiating to left arm",
  "top_k": 3
}
```

**Success `200`:**
```json
{
  "results": [
    {
      "content": "Chest pain radiating to the left arm may indicate acute myocardial infarction. Immediate actions: keep patient still, loosen tight clothing...",
      "document_title": "WHO Emergency Field Handbook",
      "page_number": 47,
      "relevance_score": 0.91
    }
  ]
}
```

**Errors:**
- `503` — knowledge base is empty (no active documents)

---

## 5. Admin — Knowledge Routes — `/api/v1/admin/knowledge`

All require `dashboard_jwt` with `role == ADMIN`. Returns `403` for any other role.

---

### `GET /api/v1/admin/knowledge/documents`
List all uploaded documents regardless of status.

**Success `200`:**
```json
{
  "documents": [
    {
      "id": "doc-uuid",
      "title": "WHO Emergency Field Handbook 2023",
      "filename": "who_emergency_2023.pdf",
      "file_size_bytes": 4200000,
      "status": "ACTIVE",
      "chunk_count": 847,
      "uploaded_by_email": "admin@medireach.app",
      "uploaded_at": "2024-01-10T09:00:00Z",
      "processed_at": "2024-01-10T09:02:14Z",
      "error_message": null
    }
  ],
  "kb_version": 7,
  "total_active_chunks": 1247
}
```

---

### `POST /api/v1/admin/knowledge/documents`
Upload a new PDF document. Uses `multipart/form-data`.

**Request (`multipart/form-data`):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | file | Yes | PDF only, max 50MB |
| `title` | string | Yes | Display name shown in dashboard |
| `description` | string | No | Optional notes about the document |

**Success `202`:**
```json
{
  "id": "doc-uuid",
  "title": "NDMA Flood Response Protocol 2024",
  "status": "PROCESSING",
  "message": "Document uploaded. Processing in background — check status in a few minutes."
}
```

**Errors:**
- `400` — file is not a PDF (MIME type check)
- `413` — file exceeds 50MB
- `409` — document with identical filename already exists and is ACTIVE

---

### `GET /api/v1/admin/knowledge/documents/{doc_id}`
Single document detail with processing status. Dashboard polls this every 5 seconds while status is PROCESSING.

**Success `200`:**
```json
{
  "id": "doc-uuid",
  "title": "NDMA Flood Response Protocol 2024",
  "filename": "ndma_flood_2024.pdf",
  "file_size_bytes": 1800000,
  "status": "PROCESSING",
  "chunk_count": null,
  "uploaded_at": "2024-01-15T10:00:00Z",
  "processed_at": null,
  "error_message": null
}
```

---

### `PATCH /api/v1/admin/knowledge/documents/{doc_id}/archive`
Deactivate a document. Removes it from RAG queries but keeps the file and database record. Triggers a knowledge base version bump.

**Request body:** None

**Success `200`:**
```json
{
  "id": "doc-uuid",
  "status": "ARCHIVED",
  "new_kb_version": 8
}
```

---

### `PATCH /api/v1/admin/knowledge/documents/{doc_id}/reprocess`
Retry ingestion for a document stuck in FAILED status. Resets status to PROCESSING and re-enqueues the Celery job.

**Request body:** None

**Success `202`:**
```json
{
  "id": "doc-uuid",
  "status": "PROCESSING",
  "message": "Reprocessing started."
}
```

**Errors:**
- `409` — document is not in FAILED status

---

### `DELETE /api/v1/admin/knowledge/documents/{doc_id}`
Hard delete. Removes the file from disk (or S3), deletes all KnowledgeChunk rows, deletes the KnowledgeDocument row, triggers a version bump.

**Request body:** None

**Success `200`:**
```json
{
  "deleted_id": "doc-uuid",
  "new_kb_version": 8,
  "message": "Document and all associated chunks deleted."
}
```

---

### `GET /api/v1/admin/knowledge/stats`
Aggregated knowledge base statistics for the system health screen.

**Success `200`:**
```json
{
  "kb_version": 7,
  "active_documents": 4,
  "total_chunks": 1247,
  "index_size_mb": 18.4,
  "last_updated": "2024-01-15T08:00:00Z",
  "top_retrieved_documents": [
    { "id": "doc-uuid", "title": "WHO Emergency Field Handbook", "retrievals_7d": 284 },
    { "id": "doc-uuid", "title": "NDMA Flood Protocol", "retrievals_7d": 91 }
  ]
}
```

---

## 6. Admin — Organization Routes — `/api/v1/admin/organizations`

All require `dashboard_jwt` with `role == ADMIN`.

---

### `GET /api/v1/admin/organizations`
List all organizations sorted by status (PENDING first).

**Success `200`:**
```json
{
  "organizations": [
    {
      "id": "org-uuid",
      "name": "Aga Khan Health Service",
      "type": "HOSPITAL",
      "status": "PENDING_APPROVAL",
      "access_code": "AKHS2024",
      "user_count": 1,
      "case_count": 0,
      "created_at": "2024-01-15T09:00:00Z"
    }
  ]
}
```

---

### `PATCH /api/v1/admin/organizations/{org_id}/approve`
Approve a pending organization. Sets status to ACTIVE, allowing its users to log in.

**Request body:** None

**Success `200`:**
```json
{
  "org_id": "org-uuid",
  "status": "ACTIVE",
  "message": "Organization approved. Users can now log in."
}
```

**Errors:**
- `409` — organization is not in PENDING_APPROVAL status

---

### `PATCH /api/v1/admin/organizations/{org_id}/suspend`
Suspend an active organization. Blocks all users in that org from logging in at next token refresh.

**Request body:**
```json
{ "reason": "Unverified credentials — pending re-verification" }
```

**Success `200`:**
```json
{
  "org_id": "org-uuid",
  "status": "SUSPENDED"
}
```

**Errors:**
- `409` — organization is already suspended
- `403` — cannot suspend the MediReach System org (the admin org)

---

## 7. Admin — System Routes — `/api/v1/admin/system`

All require `dashboard_jwt` with `role == ADMIN`.

---

### `GET /api/v1/admin/system/health`
Check status of all system dependencies.

**Success `200`:**
```json
{
  "api": "ok",
  "postgres": "ok",
  "redis": "ok",
  "celery_workers": 2,
  "checked_at": "2024-01-15T10:30:00Z"
}
```

If any dependency is down, the corresponding value is `"down"` and the route still returns `200` (so the dashboard can display which thing is failing rather than getting a 500).

---

### `GET /api/v1/admin/system/queue`
Celery queue depth for both job types.

**Success `200`:**
```json
{
  "soap_generation": {
    "pending": 3,
    "active": 1,
    "failed": 0
  },
  "document_ingestion": {
    "pending": 0,
    "active": 1,
    "failed": 0
  },
  "checked_at": "2024-01-15T10:30:00Z"
}
```

---

## 8. Real-Time Events (Socket.IO)

The dashboard connects to the Socket.IO server at `ws://localhost:3001`. Events are scoped to organization rooms — each connected dashboard client joins a room named after their `org_id`.

### Events emitted by server → dashboard

| Event | Payload | When |
|-------|---------|------|
| `case:new` | `{ caseId, triageLevel, lat, lng, chiefComplaint, receivedAt }` | New protobuf payload ingested |
| `case:soap_ready` | `{ caseId }` | Celery SOAP job completed successfully |
| `case:claimed` | `{ caseId, claimedByOrgName }` | Another responder claimed the case |
| `case:resolved` | `{ caseId, resolvedAt }` | Case marked resolved |
| `kb:updated` | `{ newVersion, documentCount }` | Knowledge base version bumped (admin action) |

### Client connection and room join

```typescript
// apps/dashboard/lib/socket.ts
import { io } from 'socket.io-client';

const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL, {
  auth: { token: accessToken }   // JWT validated server-side on connection
});

// Join the org room on connect
socket.on('connect', () => {
  socket.emit('join:org', { org_id: currentUser.org_id });
});
```

---

## 9. Utility Route

### `GET /api/v1/health`
Basic liveness check. Used by deployment platforms and the admin system health screen.

**Auth required:** None

**Success `200`:**
```json
{ "status": "ok", "version": "1.0.0" }
```
