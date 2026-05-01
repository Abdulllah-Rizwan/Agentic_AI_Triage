# DECISIONS.md — Agentic AI Triage Architecture Decision Log

This file records every significant decision made during development — what was chosen, what was rejected, and why. Update this file whenever something deviates from CLAUDE.md. Claude Code reads this to avoid re-suggesting things that have already been tried and rejected.

**How to add an entry:** Copy the template at the bottom, fill it in, and add it under the relevant section. Date format: YYYY-MM-DD.

---

## Initial Architecture Decisions (Pre-Development)

### DEC-001 — FastAPI over Express for Backend
- **Date:** Project start
- **Decision:** Use Python FastAPI instead of Node.js Express
- **Reason:** Google ADK (Agent Development Kit) is Python-native. Running ADK agents in Python avoids a language-boundary bridge. The team also has more Python familiarity from university coursework.
- **Rejected alternative:** Express.js with TypeScript — would require calling a Python subprocess for ADK, adding complexity.
- **Status:** Final

---

### DEC-002 — Llama 3.2 1B as the Universal On-Device SLM
- **Date:** Project start
- **Decision:** Use `Llama-3.2-1B-Instruct.Q4_K_M.gguf` via `llama.rn` on all devices
- **Reason:** Gemini Nano requires Pixel 6+ with Android 14+ — this excludes the majority of phones in Pakistan. A single cross-platform model is simpler to maintain and test. 1B is sufficient for structured symptom collection with a tight system prompt.
- **Rejected alternatives:**
  - Gemini Nano: device fragmentation too high for disaster use case
  - Llama 3.2 3B: ~2GB file, needs 3GB+ active RAM, excludes older mid-range devices
  - Phi-3 Mini: 2.3GB, same problem
- **FYP Presentation note:** "We chose Llama 3.2 1B for universal device compatibility. Future work includes a purpose-built medical SLM fine-tuned for clinical intake."
- **Status:** Final

---

### DEC-003 — Gemini 2.0 Flash as Cloud LLM
- **Date:** Project start
- **Decision:** Use `gemini-2.0-flash` for both cloud-side conversation and SOAP generation
- **Reason:** Native Google ADK integration with zero extra configuration. Free tier provides 15 RPM and 1M tokens/day — sufficient for FYP demo load. No separate API key needed beyond the one Google account.
- **Rejected alternatives:**
  - GPT-4o Mini: paid only, no free tier
  - Groq Llama: good but adds another service dependency
- **Status:** Final

---

### DEC-004 — Protobuf for Mobile-to-Server Payload
- **Date:** Project start
- **Decision:** Use Protocol Buffers to serialize the triage payload sent from phone to server
- **Reason:** Disaster scenarios mean 2G/GPRS connectivity. JSON payloads for a triage case are ~3-5KB; protobuf binary is ~800 bytes for the same data. This is the difference between a payload succeeding or timing out on GPRS.
- **Rejected alternative:** JSON — readable but 4-6x larger
- **Status:** Final

---

### DEC-005 — Rule-Based Triage (Not LLM-Based)
- **Date:** Project start
- **Decision:** Triage classification (RED/AMBER/GREEN) is computed by a deterministic keyword + severity rule engine, not an LLM
- **Reason:** Safety-critical. An LLM can hallucinate or be unavailable. Triage must produce a result in < 200ms with zero network dependency. The LLM cloud audit is additive (it can escalate but not initiate triage) and only runs when online.
- **Status:** Final — this rule must never be changed

---

## In-Progress Decisions (Add here as you build)

### DEC-006 — pydantic-settings for environment configuration
- **Date:** 2026-04-24
- **Decision:** Use `pydantic-settings` `BaseSettings` class in `app/core/config.py` to read all environment variables, with a module-level `settings` singleton cached via `@lru_cache`
- **Reason:** Single source of truth for every env var with type validation at startup. If a required variable is missing the server refuses to start with a clear error rather than crashing at runtime. All other modules import `settings` directly — no scattered `os.getenv()` calls.
- **Rejected alternative:** Raw `os.getenv()` calls at each use site — no validation, no autocomplete, easy to miss a variable
- **Status:** Final

---

### DEC-007 — Dual SQLAlchemy engines (async + sync)
- **Date:** 2026-04-24
- **Decision:** `app/core/database.py` creates two separate engines: an async engine (`asyncpg`) for FastAPI route handlers and a sync engine (`psycopg2`) for Celery workers
- **Reason:** FastAPI's `async def` routes require an async session; Celery tasks run in a standard synchronous thread and cannot use `await`. A single engine type would force one side to use workarounds.
- **Rejected alternative:** Running Celery with `asyncio` event loop — adds complexity and is not the Celery-recommended pattern
- **Status:** Final

---

### DEC-008 — Three distinct JWT token types
- **Date:** 2026-04-24
- **Decision:** `app/core/security.py` issues three token types with a `"type"` claim: `access` (15 min), `refresh` (7 days), `device` (30 days). Each route dependency validates the `type` claim before accepting the token.
- **Reason:** Prevents token misuse — a device token cannot be used to access dashboard routes, and a refresh token cannot be used as an access token. Enforced in code, not just by expiry.
- **Rejected alternative:** Single token type distinguished only by expiry — a stolen long-lived token would grant full access
- **Status:** Final

---

### DEC-009 — Docker PostgreSQL mapped to host port 5433
- **Date:** 2026-04-24
- **Decision:** `docker-compose.yml` maps the PostgreSQL container to host port `5433` instead of `5432`. Both database URLs in `.env` use port `5433`.
- **Reason:** Windows developer machines commonly have a local PostgreSQL service already bound to port `5432`. Docker cannot bind to the same port, causing silent connection failures where psycopg2 hits the local Postgres instead of the container and gets auth errors.
- **Rejected alternative:** Port `5432` — works on clean machines but causes hard-to-diagnose auth failures on Windows dev machines with local Postgres installed
- **Status:** Final

---

### DEC-010 — IVFFlat index for pgvector similarity search
- **Date:** 2026-04-24
- **Decision:** The initial migration creates an `ivfflat` index on `knowledge_chunks.embedding` with `lists=100` and `vector_cosine_ops`
- **Reason:** Exact nearest-neighbour search (`IndexFlatIP`) scans every row on every RAG query — acceptable at 100 chunks but unusable at 10,000+. IVFFlat gives approximate results in logarithmic time. `lists=100` is the pgvector-recommended value for corpora up to ~1M vectors.
- **Rejected alternative:** No index (exact scan) — correct but does not scale beyond a few thousand chunks
- **Status:** Final

---

### DEC-011 — Socket.IO JWT validation on connect, org-scoped rooms
- **Date:** 2026-04-24
- **Decision:** The Socket.IO `connect` handler in `main.py` validates the dashboard JWT from the `auth` object and returns `False` to reject unauthenticated clients. After connect, clients emit `join:org` to enter a room named after their `org_id`. All server-side emit calls pass `room=org_id` to scope events per organisation.
- **Reason:** Without auth on connect, any browser could subscribe to live case events. Org-scoped rooms ensure a hospital in Karachi cannot receive events for a relief camp in Peshawar.
- **Rejected alternative:** Validate token per-event — more work, and events can still be received for a brief window before the first validated event
- **Status:** Final

---

### DEC-012 — Alembic uses SYNC_DATABASE_URL, not DATABASE_URL
- **Date:** 2026-04-24
- **Decision:** `alembic/env.py` reads `settings.SYNC_DATABASE_URL` (psycopg2) and sets it as the Alembic connection URL at runtime
- **Reason:** Alembic's migration runner is synchronous and does not support asyncpg. Using `DATABASE_URL` (asyncpg) with Alembic causes an immediate driver error.
- **Rejected alternative:** Hardcoding the URL in `alembic.ini` — breaks on any machine where credentials differ and leaks secrets into version control
- **Status:** Final

---

<!-- Template — copy and fill in:

### DEC-XXX — [Short title]
- **Date:** YYYY-MM-DD
- **Decision:** [What you decided]
- **Reason:** [Why — be specific]
- **Rejected alternative:** [What else you considered]
- **Status:** [Final / Under review / Reverted]

-->

---

## Session 2 — 2026-04-25

### What was built
- All 7 FastAPI route files implemented (auth, cases, analytics, knowledge_base, admin/knowledge, admin/organizations, admin/system)
- `proto/triage.proto` created from the schema doc; Python bindings generated via `protoc` into `app/proto/triage_pb2.py`
- `app/services/socket_emitter.py` — all 5 emit functions implemented (was all stubs): `emit_new_case`, `emit_soap_ready`, `emit_case_claimed`, `emit_case_resolved`, `emit_kb_updated`
- `app/services/rag_service.py` — implemented lazy-loaded `all-MiniLM-L6-v2` sentence-transformer with pgvector cosine similarity search (was a stub)
- `app/services/index_exporter.py` — implemented `bump_version_and_export(db)`: fetches all ACTIVE chunk embeddings, builds a normalized FAISS `IndexFlatIP`, writes index + metadata pickle to disk, bumps `KnowledgeBaseVersion` (was a stub)
- `bcrypt` pinned to `3.2.2` in `requirements.txt` to resolve passlib incompatibility
- SHA-256 pre-hash added in `core/security.py` (`_prehash`) before bcrypt to handle the 72-byte hard limit

### Routes implemented
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/device-register`
- `POST /api/v1/cases/ingest`
- `GET  /api/v1/cases`
- `GET  /api/v1/cases/{case_id}`
- `PATCH /api/v1/cases/{case_id}/claim`
- `PATCH /api/v1/cases/{case_id}/resolve`
- `GET  /api/v1/analytics/summary`
- `GET  /api/v1/analytics/timeseries`
- `GET  /api/v1/analytics/symptoms`
- `GET  /api/v1/analytics/geo`
- `GET  /api/v1/knowledge/version`
- `GET  /api/v1/knowledge/index`
- `POST /api/v1/knowledge/query`
- `GET  /api/v1/admin/knowledge/documents`
- `POST /api/v1/admin/knowledge/documents`
- `GET  /api/v1/admin/knowledge/documents/{doc_id}`
- `PATCH /api/v1/admin/knowledge/documents/{doc_id}/archive`
- `PATCH /api/v1/admin/knowledge/documents/{doc_id}/reprocess`
- `DELETE /api/v1/admin/knowledge/documents/{doc_id}`
- `GET  /api/v1/admin/knowledge/stats`
- `GET  /api/v1/admin/organizations`
- `PATCH /api/v1/admin/organizations/{org_id}/approve`
- `PATCH /api/v1/admin/organizations/{org_id}/suspend`
- `GET  /api/v1/admin/system/health`
- `GET  /api/v1/admin/system/queue`

### Anything that deviated from the plan or any issues fixed
- **bcrypt 5.0.0 / passlib 1.7.4 incompatibility:** `passlib`'s internal `detect_wrap_bug` routine hashes a 72+ byte test string during backend initialisation; `bcrypt >= 4.0` rejects this with a hard `ValueError`. Fixed by pinning `bcrypt==3.2.2` in `requirements.txt` and downgrading the venv. SHA-256 pre-hash was added as defence-in-depth but was not the root cause.
- **Docker container not running:** First test of Router 1 returned a connection-refused error on port 5433. The PostgreSQL container simply wasn't started. Fixed by running `docker-compose up -d postgres`.
- **`proto/triage.proto` did not exist:** The schema doc existed (`proto/proto-SCHEMA.md`) but the actual `.proto` file had never been created, so `triage_pb2.py` was an empty stub. Created `proto/triage.proto` and generated bindings with `protoc`.
- **`API_ROUTES.md` location:** `context.md` implied it was in the project root; it is actually at `apps/api/API_ROUTES.md`.
- **`create_admin.py` deferred:** `context.md` listed it as part of Session 2 scope. Deferred to Session 3 — all 7 routers were the priority and the script has no blockers that affect router testing.
- **`analytics/symptoms` uses PostgreSQL `unnest`:** The `symptoms` column is `ARRAY(String)`. Counting per-symptom required a lateral `unnest()` join in raw SQL — no ORM equivalent exists in SQLAlchemy for this pattern.
- **`timeseries` date gaps filled in Python:** The DB query only returns dates that have cases. The full date range (oldest → today) is generated in Python and missing dates are filled with zeros so the frontend chart never has holes.
- **`/admin/knowledge/stats` `retrievals_7d` is always 0:** No retrieval-tracking table exists in the schema. The field is returned as 0 for all documents. A retrieval log table can be added in a later session if needed.

### What is next
- Session 3: Google ADK agents + Celery workers

---

## Session 3 — 2026-04-26

### What was built
- `app/workers/celery_app.py` — shared Celery instance imported by both workers; exposes `app = celery_app` alias for CLI auto-detection and declares both task modules in `include` so they are discovered on worker startup
- `app/workers/soap_worker.py` — full Celery task implementation: builds user message from case fields, runs SOAP ADK agent via `asyncio.run(runner.run_async(...))`, strips markdown fences from JSON response, upserts `SoapReport` (idempotent on retry), emits `case:soap_ready` after session closes; `max_retries=3, countdown=60`
- `app/workers/ingestion_worker.py` — full Celery task: `load_yaml_metadata()` helper reads companion `.yaml` using `_content`/`_metadata` naming convention; `_get_embedding_model()` singleton via `@lru_cache(maxsize=1)`; pipeline: TextLoader → RecursiveCharacterTextSplitter(512, 64) → all-MiniLM-L6-v2 embed → save `KnowledgeChunk` rows with YAML attribution metadata → mark doc ACTIVE → call `bump_version_and_export_sync()` → emit `kb:updated`; sets `status=FAILED` with `error_message` in a second session on exception
- `app/services/index_exporter.py` — added `bump_version_and_export_sync(db: Session)`: sync variant of the existing async function for use by Celery workers; async version unchanged for FastAPI routes
- `app/services/rag_service.py` — rewritten: `get_embedding_model()` with `@lru_cache(maxsize=1)`; raw SQL query using `<=>` cosine distance operator against pgvector; filters `status = 'ACTIVE'`; bulk-increments `retrieval_count` on matched parent documents; returns list of dicts with `content`, `article_title`, `article_url`, `article_author`, `article_source`, `relevance_score`
- `app/services/document_processor.py` — thin service layer: validates `.txt` extension, file size ≤ 50MB, valid UTF-8 content, no duplicate active filename; saves to `UPLOAD_DIR/{uuid}_{filename}`; creates `KnowledgeDocument(status=PROCESSING)`; enqueues `ingest_document_task.delay()`; returns the document object
- `app/models/db.py` — added `article_title`, `article_url`, `article_author`, `article_source` (all `String, nullable`) to `KnowledgeChunk`; added `retrieval_count` (`Integer, default=0`) to `KnowledgeDocument`
- `alembic/versions/20260426_0002_add_rag_attribution_columns.py` — migration that `ADD COLUMN`s all five new fields
- `app/models/schemas.py` — `KnowledgeQueryResult` corrected: replaced Session 2 fields (`document_title`, `page_number`) with the spec-required attribution fields (`article_title`, `article_url`, `article_author`, `article_source`)

### Any deviations from CLAUDE.md or issues fixed
- **Files 1–3 already done in Session 2:** `socket_emitter.py`, `soap_agent.py`, and `triage_audit_agent.py` were fully implemented in Session 2. Session 3 confirmed them and proceeded to the remaining files.
- **Shared `celery_app.py` added:** CLAUDE.md shows each worker creating its own `Celery(...)` instance. `context.md` overrides this with a rule requiring a single shared instance. Created `app/workers/celery_app.py` and imported from there in both workers.
- **`bump_version_and_export` kept async; sync variant added:** CLAUDE.md defines a sync `bump_version_and_export(db)`. Session 2 implemented it as `async def` for FastAPI route use. Added `bump_version_and_export_sync(db: Session)` alongside it rather than replacing it, so existing admin routes are unaffected.
- **`rag_service` keeps `db` parameter:** CLAUDE.md spec shows the function opening its own `async_session()` internally. The existing `knowledge_base.py` router (which cannot be modified) calls `await rag_service.query_knowledge_base(query, top_k, db)` with an injected session. Kept the `db` parameter to match the router call site.
- **`KnowledgeQueryResult` schema corrected:** Session 2 built this schema with `document_title` and `page_number` fields that do not exist in the API spec. Corrected to the five spec-required fields. Without this fix the `/knowledge/query` endpoint would raise a Pydantic validation error at runtime.
- **`admin/knowledge.py` upload handler not updated:** The existing router checks for PDF magic bytes (`b"%PDF"`) but the spec and API_ROUTES.md both require `.txt` only. `document_processor.py` implements the correct `.txt` validation, but wiring it into the router is deferred to Session 4 (modifying existing routers was out of scope for Session 3).
- **`runner.run_async()` used instead of `runner.run()`:** CLAUDE.md shows the sync `runner.run()` loop. AGENTS.md confirms `runner.run_async()` as the working pattern. Used `asyncio.run(runner.run_async(...))` in the Celery worker to bridge sync/async correctly.
- **Socket emits are no-ops in worker processes:** `emit_soap_ready` and `emit_kb_updated` called from Celery workers return immediately because `_sio is None` — the `sio` instance lives in the FastAPI process, not the Celery process. Acceptable for FYP demo; production would use a shared Redis adapter.
- **`google-adk==0.0.1` was a placeholder stub:** PyPI had a `0.0.1` stub registered before Google's official release. Fixed by running `pip install --upgrade google-adk` to get the real package.
- **`celery_app` variable not auto-detected by Celery CLI:** Celery's `-A` flag auto-detects attributes named `celery` or `app`. Our variable `celery_app` was not found. Fixed by adding `app = celery_app` alias in `celery_app.py`.
- **`db.py` schema additions:** `KnowledgeChunk` was missing the four article attribution columns and `KnowledgeDocument` was missing `retrieval_count`. These were in the CLAUDE.md model spec but omitted from the Session 1 migration. Added in Session 3 via migration `0002`.

### What is next
- Session 4: RAG pipeline — seed script, pgvector migration update for new chunk columns, admin upload wired to document_processor

---

## Session 4 — 2026-04-27

### What was built
- **Alembic migration 0003** — drops `page_number` from `knowledge_chunks`; corresponding ORM column removed from `db.py` to keep schema in sync
- **Admin upload wired to `document_processor`** — `admin/knowledge.py` upload handler stripped of inline logic; now delegates entirely to `process_document_upload()`; added `author`, `source`, `url` as optional `Form(None)` fields that flow through to `KnowledgeChunk` attribution columns
- **Attribution metadata propagation** — `document_processor.py` accepts `author/source/url` kwargs and forwards them to `ingest_document_task.delay()`; ingestion worker prefers form-supplied values and falls back to companion YAML when none are provided
- **Seed script** — `docs/knowledge-base/build_baseline_index.py`: scans `docs/knowledge-base/articles/` for `*.txt` + `*.yaml` pairs, chunks with `RecursiveCharacterTextSplitter(512, 64)`, embeds with `all-MiniLM-L6-v2`, builds a normalized `faiss.IndexFlatIP(384)`, saves `knowledge_index.faiss` + `knowledge_meta.pkl` to `apps/mobile/src/assets/knowledge/`
- **Mobile assets directory** — `apps/mobile/src/assets/knowledge/.gitkeep` created; `.gitignore` updated to exclude `*.faiss` and `*.pkl` from version control
- **Pipeline test script** — `apps/api/scripts/test_rag_pipeline.py`: end-to-end Steps A–E (upload, poll until ACTIVE, version bump check, RAG query, FAISS binary download)
- **Session 4 verification suite** — `apps/api/scripts/session4_verify.py`: 10 automated checks covering DB schema, upload, attribution propagation, RAG query correctness, archive, delete (file + chunks + 404), reprocess, seed FAISS loadable, index download, and version endpoint; all 10 pass

### Pipeline test results
- Files processed by seed script: 15
- Total chunks in knowledge base: 304
- RAG query working: yes
- FAISS export working: yes

### Any deviations or issues fixed
- **Naming convention deviation:** CLAUDE.md spec uses `*_content.txt` / `*_metadata.yaml` suffixes; actual article files in `docs/knowledge-base/articles/` use plain `*.txt` / `*.yaml` pairs. Seed script updated to match actual filenames.
- **Migration 0002 already done:** Session 3 created migration 0002 for the attribution columns. Session 4 only needed to drop `page_number` (migration 0003). No overlap.
- **Task 3 already done:** Archive and delete routes calling `bump_version_and_export` were wired in Session 3; skipped in Session 4.
- **asyncpg `::cast` syntax error** in `rag_service.py`: asyncpg translates `:param` to `$1` and then misparses `$1::vector` as a syntax error. Fixed by rewriting all casts as `CAST(:param AS vector)` and `CAST(:param AS uuid[])`.
- **`TIMESTAMP WITHOUT TIME ZONE` rejected offset-aware datetimes** in `index_exporter.py` and `ingestion_worker.py`: `datetime.now(timezone.utc)` produces a tz-aware object that PostgreSQL rejects for tz-naive columns. Fixed with `datetime.utcnow()` throughout.
- **NumPy 2.x / faiss-cpu incompatibility:** faiss-cpu wheel was compiled against NumPy 1.x; NumPy 2.4.4 was active in the venv. Fixed by pinning `numpy<2` in the venv.
- **Windows cp1252 encoding errors:** Unicode checkmark (`✓`) and box-drawing (`─`) characters in test script print statements caused `UnicodeEncodeError` on Windows terminal. Replaced with ASCII equivalents.
- **Port conflict on server restart:** Stale uvicorn process held port 3001. Killed via `Stop-Process -Id <pid> -Force`.

### What is next
- Session 5: Next.js dashboard — scaffold, cases screen, real-time Socket.IO, Leaflet map

---

## Session 5 — 2026-05-01

### What was built
- Next.js 14 dashboard project scaffolded manually inside `apps/dashboard/` (npx could not run due to Anaconda path-mangling in the bash shell — see deviations)
- `package.json`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `.env.local`, `.gitignore` — all config files created from scratch
- 441 packages installed via PowerShell (bypassing the Anaconda bash path issue)
- `auth.ts` — NextAuth v5 (beta) Credentials provider: calls `POST /api/v1/auth/login`, stores `id`, `email`, `role`, `org_id`, `org_name`, `access_token`, `refresh_token` in the JWT
- `app/api/auth/[...nextauth]/route.ts` — thin handler exporting `{ GET, POST }` from `auth.ts`
- `middleware.ts` — protects all routes except `/login`; redirects non-ADMIN users away from `/admin/*` back to `/cases`
- `types/next-auth.d.ts` — session type augmentation adding `role`, `org_id`, `org_name`, `access_token`
- `app/layout.tsx` — root layout with Inter font and `SessionProvider` wrapper
- `app/(auth)/layout.tsx` — passthrough layout for the auth route group
- `app/(dashboard)/layout.tsx` — authenticated shell: fixed 240 px sidebar, Admin section visible only when `role === "ADMIN"`, Socket.IO connection indicator in the header
- `app/(dashboard)/cases/page.tsx` — full cases list: filter bar (ALL / CRITICAL / URGENT), sort dropdown, skeleton loading, empty state, real-time `case:new` / `case:soap_ready` / `case:claimed` Socket.IO events, new-card highlight animation
- `app/(dashboard)/cases/[id]/page.tsx` — case detail: two-column layout, patient info card, symptom chips, full four-section SOAP view, Claim / Mark Resolved buttons
- `app/(dashboard)/analytics/page.tsx` — placeholder stub
- `app/(dashboard)/resources/page.tsx` — placeholder stub
- `app/(dashboard)/admin/knowledge/page.tsx` — placeholder stub
- `app/(dashboard)/admin/organizations/page.tsx` — placeholder stub
- `app/(dashboard)/admin/system/page.tsx` — placeholder stub
- `app/(auth)/login/page.tsx` — dark login card, email + password fields, loading spinner, inline error, "Register" link
- `app/(auth)/register/page.tsx` — empty stub
- `lib/api.ts` — typed API client wrapping all 25+ endpoints (auth, cases, analytics, knowledge, admin/knowledge, admin/orgs, admin/system); Bearer token auto-attached from NextAuth session
- `lib/socket.ts` — Socket.IO client with `useSocket(token, orgId)` hook; joins `join:org` room on connect; exports `isConnected` state
- `components/providers.tsx` — `SessionProvider` client wrapper used by root layout
- `apps/api/scripts/create_admin.py` — seeds two test accounts on first run (idempotent)

### UI components created
- `components/TriageBadge.tsx` — color-coded pill: RED → "CRITICAL" (bg-red-600), AMBER → "URGENT" (bg-amber-500), GREEN → "MINOR" (bg-green-600)
- `components/CaseCard.tsx` — four-row card: triage badge + relative time, chief complaint (2-line clamp), triage reason (1-line clamp), coordinates + View SOAP / Claim / Claimed buttons
- `components/SoapReportPanel.tsx` — 480 px right-side slide-over: patient row, location, four color-bordered SOAP sections (blue/purple/amber/green), loading skeleton, "not available" state, model + timestamp footer
- `components/CasesMap.tsx` — Leaflet map with CartoDB Dark Matter tiles, `CircleMarker` per case colored by triage level (red r=10 / amber r=8 / green r=6), click → opens SOAP panel; SSR-safe (loaded via `dynamic(ssr:false)`)
- `components/admin/DocumentUploadForm.tsx` — empty stub
- `components/admin/DocumentTable.tsx` — empty stub
- `components/admin/OrgTable.tsx` — empty stub
- `components/admin/SystemHealthCard.tsx` — empty stub

### Test results
- Login page renders: **yes** — `GET /login` returns 200
- Route guard working: **yes** — unauthenticated `GET /cases` returns 307 → `/login`
- Admin route guard: **yes** — middleware redirects non-ADMIN to `/cases`
- TypeScript: **yes** — `tsc --noEmit` exits clean with zero errors
- Cases page loads: **not tested end-to-end** — API server was not running during session; page compiled successfully
- Real-time Socket.IO working: **not tested** — requires API server + active session
- Map renders: **not tested** — requires auth to reach /cases
- SOAP panel working: **not tested** — requires auth + a case with a SOAP report
- Login with real credentials: **not tested** — API server was not running; test accounts exist in DB

### Any deviations from CLAUDE.md or issues fixed
- **`npx create-next-app` unusable:** Anaconda's bash environment translates Windows drive paths (`C:\`) into `D:\anaconda\Library\c\` before passing them to Node, causing `MODULE_NOT_FOUND` on every npx-executed package. Worked around by writing all config files manually and installing via `npm install` run through PowerShell (which uses native paths). PowerShell itself required `Set-ExecutionPolicy Bypass` per-session due to system policy.
- **`next.config.ts` not supported in Next.js 14:** TypeScript config files were introduced in Next.js 15. Initial file caused an immediate startup error. Replaced with `next.config.mjs`.
- **`Geist` not in `next/font/google` for Next.js 14:** `Geist` was added to `next/font/google` in Next.js 15. Using it in v14 produces `Module has no exported member 'Geist'`. Replaced with `Inter`.
- **`react-leaflet` missing from initial package.json:** Added and installed separately after TypeScript flagged `Cannot find module 'react-leaflet'`.
- **NextAuth v5 (beta) API differs from v4:** CLAUDE.md examples use the v4 single-export pattern. v5 requires a separate `auth.ts` file that exports `{ handlers, auth, signIn, signOut }`, with the route handler re-exporting `handlers`. Used the v5 pattern throughout.
- **Route group conflict:** Pages created outside `(dashboard)` (e.g. `app/cases/page.tsx`) would conflict with pages inside `app/(dashboard)/cases/page.tsx` since both resolve to `/cases`. Removed files outside the route group; all pages live exclusively inside `app/(dashboard)/`.
- **`create_admin.py` finally created:** This script was deferred in Session 2 and again in Session 3. Created in Session 5 and executed successfully — seeded two test accounts: `admin@medireach.app` (ADMIN) and `responder@test.com` (RESPONDER), both with ACTIVE org status.
- **API server not started during session:** The FastAPI uvicorn process must be started manually in a terminal (`uvicorn app.main:socket_app --reload --port 3001`) before the dashboard login flow can be tested end-to-end.

### What is next
- Session 6: Analytics dashboard + admin screens (Knowledge Base, Organizations, System Health)

---

## Session 6 — 2026-05-01

### What was built
- `components/CaseHistoryTable.tsx` — resolved/closed cases table below the active cases list; columns: Case ID (monospace, first 8 chars), Status pill, TriageBadge, Chief Complaint (truncated 40 chars), Location (4 d.p.), Received date, Duration (client-side "1h 23m" from `received_at` → `resolved_at`), View Report link; empty state with icon
- `app/(dashboard)/cases/page.tsx` updated — parallel fetch for active cases + history (status `RESOLVED,CLOSED`); active cases + map wrapped in `h-[70vh]` container; history table rendered below in a scrollable section
- `components/analytics/KPICard.tsx` — reusable card with title, large value, subtitle, Lucide icon (configurable accent colour), optional trend indicator (TrendingUp/TrendingDown with ±% label)
- `app/(dashboard)/analytics/page.tsx` — full analytics page: 4 KPI cards (Total Cases, Critical Cases, Avg Response Time, Resolution Rate); shared `days` state (7/30/90) drives all three charts simultaneously; skeleton loaders for cards
- `components/analytics/CasesTimelineChart.tsx` — Recharts `LineChart` with three lines (RED #ef4444, AMBER #f59e0b, GREEN #22c55e), dark-themed tooltip and grid, `7D | 30D | 90D` toggle that fires `onDaysChange`; skeleton while fetching
- `components/analytics/TopSymptomsChart.tsx` — Recharts `BarChart` in `layout="vertical"` (horizontal bars), blue-500 bars with right-side rounded corners, Y-axis symptom names truncated to 25 chars, top 10 only; re-fetches on `days` change; empty state if no data
- `components/analytics/GeoHeatmap.tsx` — client-only Leaflet map with `leaflet.heat` heatmap layer; CartoDB Dark Matter tiles; centre Karachi (24.8607, 67.0011) zoom 10; blue→amber→red gradient; dynamic reimport of heat layer on `points` prop change; mounted via `dynamic(ssr:false)` in parent
- `components/resources/ResourceCard.tsx` — reusable card with Lucide icon (blue-500), badge pill, title, description, action as `<a>` (download) or `<button>` (tool modal)
- `app/(dashboard)/resources/page.tsx` — static Medical Resources page: Section 1 Guidelines (4 download cards, WHO/NDMA badges); Section 2 Interactive Tools (2 cards opening "Coming Soon" modals for GCS Calculator and Burn Estimator); Section 3 Emergency Directory (table with tel: links, colour-coded type labels); Section 4 Training (progress bar card at 0%, "Start Training" button)
- `components/admin/DocumentUploadForm.tsx` — controlled form: Title (required), Author, Source, URL, Description; drag-and-drop `.txt` zone (green on file selected, blue on drag-over); `FormData` built and submitted via `uploadDocument()`; inline error banner; spinner + disabled state while submitting
- `components/admin/DocumentTable.tsx` — table with StatusBadge (amber spinner for PROCESSING, green/red/gray dots for ACTIVE/FAILED/ARCHIVED); chunk count, file size, uploader email, relative date; per-row actions (Archive, Re-process, Delete) gated by status; auto-polling via `setInterval` every 5 s for PROCESSING rows — stops on terminal state; skeleton and empty state
- `app/(dashboard)/admin/knowledge/page.tsx` — 35/65 two-column layout; parallel fetch of documents + stats; Socket.IO `kb:updated` listener triggers refresh; stats footer (`v{n} · N active docs · N,NNN chunks · last updated X ago`); blue info banner explaining mobile sync behaviour; ADMIN role guard via `useEffect` + `useRouter`
- `components/admin/OrgTable.tsx` — org table sorted PENDING_APPROVAL first; TypeBadge (blue NGO, purple HOSPITAL, red GOVT, orange RELIEF_CAMP); StatusBadge (pulsing amber dot for pending); per-row actions: Approve + Reject (pending), Suspend via confirmation modal (active), Reactivate (suspended); modal requires non-empty reason field before confirming suspend
- `app/(dashboard)/admin/organizations/page.tsx` — fetches org list on mount; live count summary pills (amber for pending, green for active, red for suspended); skeleton rows while loading; ADMIN role guard
- `components/admin/SystemHealthCard.tsx` — card with coloured left-accent bar (green/red), CheckCircle/XCircle icon, status label, optional value string, last-checked timestamp
- `app/(dashboard)/admin/system/page.tsx` — 2×2 health card grid (API, PostgreSQL, Redis, Celery Workers with count); queue table (SOAP Generation, Document Ingestion) with pending/active/failed columns and yellow warning banner if pending > 50; 4 RAG stat cells (KB Version, Active Documents, Total Chunks, Index Size); top-5 retrieved documents table with blue pill badge; 30 s polling via `setInterval`; live "last updated Xs ago" counter; ADMIN role guard
- `leaflet.heat` + `@types/leaflet.heat` installed (2 packages, via `cmd /c npm install` due to PowerShell execution policy)

### Screens completed
- Cases page (active list + history table): **yes — complete**
- Case detail page: **yes — already built in Session 5, untouched**
- Analytics page (KPI cards + all three charts): **yes — complete**
- Medical Resources page: **yes — complete**
- Admin / Knowledge Base: **yes — complete**
- Admin / Organizations: **yes — complete**
- Admin / System Health: **yes — complete**
- Login page: **yes — already built in Session 5, untouched**

### Visual consistency
- `animate-pulse-once` used in `CaseCard` for new incoming cases was not a real Tailwind class — defined it in `tailwind.config.ts` as a custom keyframe (3× opacity pulse over 1 s each)
- `SoapReportPanel` close button was missing `rounded-lg p-1.5 hover:bg-gray-800` — added to match every other icon button across the dashboard
- All three admin pages called `redirect()` from `next/navigation` inside the render of client components — this is a server-only API and throws in client components; replaced with `useEffect` + `useRouter().replace()` in all three pages
- `CaseHistoryTable` used an inline double-cast `(c as CaseListItem & {...}).resolved_at` — replaced with a named `CaseListItemWithResolved` type alias declared once at the top of the file and a single cast on the `map()` call
- All pages verified consistent: `bg-gray-950` page background, `bg-gray-900` cards, `bg-gray-800` elevated elements/table headers, `text-white` primary, `text-gray-400` secondary, `text-gray-500` muted, `border-gray-800` borders; `p-5`/`p-6` card padding, `gap-4`/`gap-6` between cards; all interactive elements have `transition-colors hover:` states; all loading states use skeleton loaders; all empty states have Lucide icon + message; sidebar active item correctly highlighted on every page via `pathname` comparison; `TriageBadge` used in every location a triage level is displayed

### Any deviations from CLAUDE.md or issues fixed
- **`npm install` via PowerShell blocked:** PowerShell execution policy prevented running `npm.ps1`. Worked around with `cmd /c npm install leaflet.heat @types/leaflet.heat` — this is the same workaround used in Session 5 for all npm commands on this machine.
- **`leaflet.heat` HeatLayer typed with `@ts-expect-error`:** `leaflet.heat` patches `L` at runtime by adding `L.heatLayer`. TypeScript has no way to see this at compile time. Used `@ts-expect-error` on the two call sites rather than writing a custom `.d.ts` override — sufficient for FYP.
- **GeoHeatmap heat layer removal on points update:** Standard Leaflet `map.eachLayer()` cannot reliably identify heat layers by type across module boundaries. Used a duck-type check (`"_latlngs" in layer`) as a heuristic to remove the old layer before adding the new one. This is safe because `CircleMarker` and `TileLayer` do not have `_latlngs`.
- **`resolved_at` absent from `CaseListItem` type:** `lib/api.ts` was not modified (per session rules). The API almost certainly returns `resolved_at` on list items (it does on `CaseDetail`), but the shared type omits it. Handled with a local `CaseListItemWithResolved` extension type in `CaseHistoryTable.tsx`. Duration will show "—" if the API truly does not send the field.
- **Suspend / Reject share the same API endpoint:** ADMIN.md specifies `suspendOrg(id, reason)` for both Suspend and Reject. Reject calls the same endpoint with a preset reason string `"Registration rejected by admin."` rather than prompting for a reason — consistent with the fast-action pattern expected for a reject button.
- **Reactivate uses `approveOrg`:** There is no dedicated reactivate endpoint in `lib/api.ts` or the backend routes. Reactivating a SUSPENDED org goes through `approveOrg(id)` (the same PATCH `/approve` endpoint), which sets status back to ACTIVE. This matches the backend implementation.
- **`GeoHeatmap` uses imperative Leaflet rather than `react-leaflet`:** `react-leaflet` has no `HeatLayer` component and `leaflet.heat` patches the `L` global imperatively. Used raw `leaflet` + `useEffect` for the heatmap map — same pattern as `CasesMap` uses `react-leaflet` for its markers. Two different Leaflet usage patterns coexist in the codebase; this is intentional.

### What is next
- Session 7: Mobile app scaffold, registration screen, home screen, network orchestrator, LLM adapters

---

## Reverted Decisions

<!-- Move entries here if a decision was reversed, and document why. -->
