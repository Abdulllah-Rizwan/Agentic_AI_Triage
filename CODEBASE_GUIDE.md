# MediReach — Complete Codebase Guide

> Written for FYP presentation preparation. Covers every folder, every key file, how everything connects, and all technology decisions with their trade-offs.

---

## Table of Contents

1. [What MediReach Actually Is](#1-what-medireach-actually-is)
2. [The Big Picture — System Architecture](#2-the-big-picture--system-architecture)
3. [Repository Layout](#3-repository-layout)
4. [App 1: The Mobile App (React Native)](#4-app-1-the-mobile-app-react-native)
5. [App 2: The Backend API (FastAPI)](#5-app-2-the-backend-api-fastapi)
6. [App 3: The Web Dashboard (Next.js)](#6-app-3-the-web-dashboard-nextjs)
7. [How Data Flows Through the Entire System](#7-how-data-flows-through-the-entire-system)
8. [The Agentic AI Components](#8-the-agentic-ai-components)
9. [Technology Choices and Trade-offs](#9-technology-choices-and-trade-offs)
10. [Key Files Quick Reference](#10-key-files-quick-reference)
11. [Shared Infrastructure](#11-shared-infrastructure)
12. [Common Examiner Questions](#12-common-examiner-questions)

---

## 1. What MediReach Actually Is

MediReach solves a specific, real problem: during a natural disaster (flood, earthquake), affected people need medical help but:
- Cell towers are down or overloaded → no internet
- Hospitals are overwhelmed → cannot triage walk-ins
- NGOs and relief teams cannot know who needs help most urgently

MediReach lets a stranded patient open an app on their phone, describe their symptoms in a chat, and have the app:
1. **Collect** symptoms using an AI conversation (works offline)
2. **Triage** them using a rule-based algorithm (instant, deterministic, no AI needed)
3. **Transmit** a compressed medical report to a command dashboard the moment any signal appears
4. **Prioritize** responders by severity so RED cases (life-threatening) are dispatched first

The secondary feature is **appointment booking** — between disasters, patients can book doctor appointments and the doctor receives a structured clinical SOAP note before they arrive.

---

## 2. The Big Picture — System Architecture

The system is built as a **5-stage intelligence relay**. Each stage can degrade gracefully without breaking the others.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         PATIENT'S PHONE                              │
│                                                                      │
│  [Chat UI]                                                           │
│      ↓                                                               │
│  [SymptomCollectorAgent]  ← decides what to ask next                │
│      ↓ uses                                                          │
│  [NetworkOrchestrator] → FULL: Gemini (cloud)                        │
│                        → OFFLINE/DEGRADED: Phi-4 mini (on device)   │
│      ↓                                                               │
│  [TriageEngine] → keyword matching → RED / AMBER / GREEN             │
│      ↓                                                               │
│  [TransmissionService] → online: send now                            │
│                        → offline: encrypt + cache in SQLite          │
│      ↓ (when signal returns)                                         │
└──────────────────────────────────────────────────────────────────────┘
                              ↓ HTTPS (protobuf binary)
┌──────────────────────────────────────────────────────────────────────┐
│                       FASTAPI BACKEND                                │
│                                                                      │
│  POST /api/v1/cases/ingest                                           │
│      ↓                                                               │
│  Decode protobuf → Hash CNIC → Save to PostgreSQL                    │
│      ↓ if RED or AMBER                                               │
│  Celery Queue → SOAP Agent (Google ADK + Gemini) → SoapReport table │
│      ↓                                                               │
│  Socket.IO → push "case:new" + "case:soap_ready" to dashboard        │
└──────────────────────────────────────────────────────────────────────┘
                              ↓ WebSocket
┌──────────────────────────────────────────────────────────────────────┐
│                     RESPONDER DASHBOARD (Next.js)                    │
│                                                                      │
│  Case list → sorted RED first → claim → resolve                      │
│  Map → GPS pins for all active cases                                 │
│  Analytics → KPIs, charts, heatmaps                                  │
│  Admin → upload knowledge docs, manage orgs, system health           │
└──────────────────────────────────────────────────────────────────────┘
```

### The Three Network Modes

Everything in the app routes through one of three modes:

| Mode | What happened | LLM used | Data transmission |
|------|---------------|----------|-------------------|
| **FULL** | WiFi or 4G available | Gemini API (cloud) | Send immediately |
| **DEGRADED** | 2G/GPRS, high latency | Phi-4 mini (on-device) | Send (lean protobuf fits on 2G) |
| **OFFLINE** | No signal at all | Phi-4 mini (on-device) | Cache encrypted in SQLite, retry every 60s |

---

## 3. Repository Layout

```
Agentic_AI_Triage/                ← project root
├── apps/
│   ├── mobile/                   ← React Native patient app
│   ├── api/                      ← FastAPI Python backend
│   └── dashboard/                ← Next.js responder dashboard
├── proto/
│   └── triage.proto              ← shared Protobuf schema (source of truth)
├── docs/
│   └── knowledge-base/           ← seed WHO articles for the RAG system
├── docker-compose.yml            ← runs PostgreSQL + Redis locally
├── CLAUDE.md                     ← full architecture spec
├── decisions.md                  ← session-by-session log of every bug fix
└── Logo.jpg                      ← project logo
```

---

## 4. App 1: The Mobile App (React Native)

**Location:** `apps/mobile/`
**Framework:** React Native with Expo bare workflow
**Language:** TypeScript

### Folder Structure

```
apps/mobile/
├── App.tsx                       ← entry point: bootstrap sequence, navigator setup
├── app.json                      ← Expo config (app name, permissions, build settings)
├── eas.json                      ← EAS Build profiles (preview APK, production)
├── src/
│   ├── agents/
│   │   └── SymptomCollectorAgent.ts     ← THE core AI agent
│   ├── screens/
│   │   ├── SplashScreen.tsx             ← loading gate (model init here)
│   │   ├── LoginScreen.tsx
│   │   ├── RegistrationScreen.tsx       ← CNIC + phone + password
│   │   ├── HomeScreen.tsx               ← network badge + BEGIN ASSESSMENT button
│   │   ├── ChatScreen.tsx               ← the triage conversation UI
│   │   ├── TriageResultScreen.tsx       ← result display + first-aid guidance
│   │   └── AppointmentBookingScreen.tsx ← doctor search + slot booking
│   ├── services/
│   │   ├── network/
│   │   │   └── NetworkOrchestrator.ts   ← connectivity monitor, mode switch
│   │   ├── llm/
│   │   │   ├── LLMAdapter.interface.ts  ← interface both adapters implement
│   │   │   ├── CloudLLMAdapter.ts       ← calls Gemini REST API
│   │   │   └── SLMAdapter.ts            ← runs Phi-4 mini GGUF on device
│   │   ├── rag/
│   │   │   ├── LocalRAG.ts              ← queries the FAISS index on device
│   │   │   └── queryGuidance.ts         ← decides server vs local RAG
│   │   ├── triage/
│   │   │   └── TriageEngine.ts          ← rule-based RED/AMBER/GREEN classifier
│   │   ├── transmission/
│   │   │   ├── TransmissionService.ts   ← encrypt → send → retry
│   │   │   └── DeviceTokenService.ts    ← device JWT management
│   │   ├── encryption/
│   │   │   └── AESEncryption.ts         ← AES-256-GCM encrypt/decrypt
│   │   └── knowledge/
│   │       └── KnowledgeBaseUpdateService.ts ← silent index download on startup
│   ├── store/                           ← Zustand global state slices
│   │   ├── chatStore.ts                 ← messages array, typing state
│   │   ├── networkStore.ts              ← current mode (OFFLINE/DEGRADED/FULL)
│   │   ├── sessionStore.ts              ← active session data
│   │   ├── themeStore.ts                ← dark/light toggle + SQLite persist
│   │   ├── transmissionStore.ts         ← event bus: notifies UI when case is sent
│   │   └── userStore.ts                 ← registered user profile
│   ├── db/
│   │   ├── database.ts                  ← SQLite connection init
│   │   ├── migrations.ts                ← schema versioning (PRAGMA user_version)
│   │   └── queries.ts                   ← all SQL helpers (save/load functions)
│   ├── proto/
│   │   ├── triage.ts                    ← generated TypeScript protobuf classes
│   │   └── triage.json                  ← protobuf JSON descriptor
│   ├── i18n/
│   │   ├── index.ts                     ← i18next setup
│   │   ├── en.json                      ← English strings
│   │   └── ur.json                      ← Urdu strings
│   ├── theme/
│   │   └── colors.ts                    ← dark/light color tokens
│   └── assets/
│       ├── logo.jpg
│       ├── models/
│       │   └── Phi-4-mini-instruct-Q4_K_M.gguf   ← ~500MB on-device AI model
│       └── knowledge/
│           ├── knowledge_index.faiss    ← FAISS vector index (bundled at install)
│           ├── knowledge_meta.pkl       ← chunk texts + metadata
│           └── knowledge_embeddings.json
```

### Key File Details

#### `App.tsx` — Bootstrap Sequence
This is the entry point. On launch it:
1. Initializes SQLite and runs schema migrations
2. Loads user profile (routes to Login or Home)
3. Starts `NetworkOrchestrator` (begins polling connectivity)
4. Starts `SLMAdapter.initialize()` in parallel (loads the 500MB model into RAM)
5. Restores theme preference from SQLite
6. Sets up the React Navigation stack

#### `SplashScreen.tsx` — Loading Gate
Shows the logo and "OFFLINE READY" badge. The badge is:
- **Green**: SLM fully loaded
- **Amber**: still loading
- **Red**: load failed

Navigation only proceeds when both the SLM and network orchestrator are ready (or after a 30-second timeout in which case the app runs in cloud-only mode).

#### `ChatScreen.tsx` — The Core Screen
The most complex screen. Manages:
- Real-time chat UI (FlatList of message bubbles)
- Calls `SymptomCollectorAgent.next()` on every user message
- Listens for `CRITICAL` status → shows Emergency Notification Bar (red banner, slides up)
- Listens for `SUFFICIENT` status → triggers `_handlePostTriage()`:
  1. Runs `TriageEngine.computeTriage(featureVector)` → level
  2. Shows triage verdict in chat
  3. Calls `queryGuidance()` → fetches first-aid from RAG (8-second timeout)
  4. Shows guidance in chat
  5. Encrypts payload and calls `TransmissionService.sendOrCache()`
  6. Shows "sent" or "cached" status message
  7. Sets `postTriageState` → reveals "Book Appointment" button in sticky bar
  8. Clears the active session slot in SQLite (prevents stale sessions)
- Subscribes to `transmissionStore` to detect when a cached case finally transmits

#### `SymptomCollectorAgent.ts` — The AI Agent
A hand-written agentic loop (NOT using any framework — raw TypeScript). Each call to `next(userMessage)`:
1. Appends the user message to conversation history
2. Calls `networkOrchestrator.getLLMAdapter().chat(history, systemPrompt)`
3. Parses the response for `{"status":"SUFFICIENT"}` or `{"status":"CRITICAL","trigger":"..."}`
4. If neither token is found, it is a regular question → return it as the next agent message
5. On `SUFFICIENT`: build and return the `MedicalFeatureVector` (structured symptom data)
6. On `CRITICAL`: return with `status: "CRITICAL"` and the trigger symptom

#### `NetworkOrchestrator.ts` — The Traffic Controller
Runs continuously in the background. Uses `@react-native-community/netinfo` to poll every 5 seconds. Classifies connections:
- **FULL**: WiFi or cellular with effective type `4g`
- **DEGRADED**: cellular with effective type `2g`, `3g`, or latency > 500ms
- **OFFLINE**: no connection

On mode change it:
- Notifies all registered callbacks (UI badge updates)
- Switches which LLM adapter is returned by `getLLMAdapter()`
- If upgrading from OFFLINE → FULL, calls `TransmissionService.flushQueue()`

#### `SLMAdapter.ts` — On-Device AI
Loads and runs the Phi-4 mini GGUF model via the `llama.rn` library. Key settings:
- **Context window**: 1024 tokens (symptom conversations are short)
- **Chat format**: Phi chat template (`<|system|>...<|end|><|user|>...<|end|><|assistant|>`)
- **Stop tokens**: end-of-text tokens for Phi-4
- **Dev mode**: when `EXPO_PUBLIC_ENVIRONMENT=development`, routes to local Ollama instead of the bundled model (faster iteration)

#### `TransmissionService.ts` — Reliable Delivery
Guarantees every case reaches the server eventually. Flow:
1. Encode payload to Protobuf binary
2. Encrypt with AES-256-GCM (key derived from CNIC + device ID via PBKDF2)
3. Attempt HTTP POST to `/api/v1/cases/ingest` with 10-second timeout
4. If success (202): delete from SQLite, update `transmissionStore`
5. If failure: store encrypted blob in `pending_payloads` SQLite table
6. Background retry loop runs every 60 seconds, up to 5 attempts per case

#### `TriageEngine.ts` — The Safety-Critical Component
Rule-based. No AI involved. Two keyword lists:
- **RED keywords**: chest pain, cannot breathe, uncontrolled bleeding, unconscious, crush injury, seizure, snake bite, anaphylaxis, stroke, amputation, severe burn
- **AMBER keywords**: fracture, deep wound, fever above 39, vomiting blood, head injury, electric shock, severe dehydration

If `severity >= 8` OR any RED keyword found → RED
If `severity >= 5` OR any AMBER keyword found → AMBER
Otherwise → GREEN

**Why no AI here?** Safety-critical decisions must be deterministic and instant. An LLM could hallucinate or timeout.

#### SQLite Database (3 tables)
- **`user_profile`**: one row, the registered patient (name, CNIC, phone, GPS)
- **`pending_payloads`**: encrypted reports waiting to be sent (auto-retried)
- **`completed_cases`**: assessment history shown in "My Assessments"

Additional metadata stored via `app_metadata` key-value table (theme preference, knowledge base version, chat histories).

---

## 5. App 2: The Backend API (FastAPI)

**Location:** `apps/api/`
**Language:** Python 3.11+
**Framework:** FastAPI + Pydantic v2

### Folder Structure

```
apps/api/
├── alembic/
│   └── versions/                        ← database migration files (run in order)
│       ├── 0001_initial_schema.py        ← creates all base tables
│       ├── 0002_add_rag_attribution.py   ← adds article_title/url/author to chunks
│       ├── 0003_drop_page_number.py      ← cleanup
│       ├── 0004_section_type.py          ← adds section_type for RAG filtering
│       ├── 0005_guidelines_table.py      ← medical guidelines download table
│       └── 0006_add_appointments.py      ← practitioners, slots, appointments
├── app/
│   ├── main.py                          ← FastAPI app, middleware, router mounts
│   ├── core/
│   │   ├── config.py                    ← Pydantic Settings (reads from .env)
│   │   ├── database.py                  ← SQLAlchemy async engine + session factory
│   │   └── security.py                  ← JWT creation/verification, bcrypt hashing
│   ├── models/
│   │   ├── db.py                        ← all SQLAlchemy ORM table definitions
│   │   └── schemas.py                   ← Pydantic request/response models
│   ├── routers/
│   │   ├── auth.py                      ← login, register, token refresh, device-register
│   │   ├── cases.py                     ← ingest, list, detail, claim, resolve
│   │   ├── analytics.py                 ← KPI summary, timeseries, symptoms, geo
│   │   ├── appointments.py              ← list practitioners, book slots
│   │   ├── guidelines.py                ← download medical PDF guidelines
│   │   ├── knowledge_base.py            ← version check, index download, query
│   │   └── admin/
│   │       ├── knowledge.py             ← upload/list/delete/archive documents
│   │       ├── organizations.py         ← approve/suspend organizations
│   │       ├── practitioners.py         ← manage doctors + availability slots
│   │       └── system.py                ← health check, queue stats, RAG stats
│   ├── agents/
│   │   ├── soap_agent.py                ← Google ADK SOAP generation agent
│   │   └── triage_audit_agent.py        ← optional: audits device-computed triage
│   ├── services/
│   │   ├── rag_service.py               ← pgvector cosine similarity search
│   │   ├── document_processor.py        ← PDF parsing + chunking
│   │   ├── index_exporter.py            ← rebuilds FAISS index from active chunks
│   │   ├── socket_emitter.py            ← Socket.IO event helpers
│   │   ├── notification.py              ← FCM push to patient device
│   │   └── soap_generator.py            ← SOAP generation utilities
│   ├── workers/
│   │   ├── celery_app.py                ← Celery instance + Redis broker config
│   │   ├── soap_worker.py               ← async task: generate SOAP for a case
│   │   └── ingestion_worker.py          ← async task: chunk + embed uploaded documents
│   └── proto/
│       └── triage_pb2.py                ← generated Python protobuf classes
├── exports/                             ← FAISS index files served as static files
├── uploads/                             ← uploaded PDF/TXT documents
├── requirements.txt
└── Dockerfile
```

### Key File Details

#### `app/main.py` — The App Entry Point
Creates the FastAPI instance. Key responsibilities:
- Attaches CORS middleware (only allows requests from the dashboard URL)
- Mounts all routers under `/api/v1/`
- Creates a Socket.IO `AsyncServer` and wraps FastAPI in an ASGI adapter
- Serves the FAISS export directory as static files at `/exports/`
- Exposes `GET /api/v1/health` for uptime monitoring

The `socket_app = socketio.ASGIApp(sio, app)` line is important: Uvicorn runs `socket_app`, not `app` directly, because WebSocket connections need the Socket.IO ASGI layer.

#### `app/core/config.py` — Settings
A Pydantic `BaseSettings` class that reads from `.env`. Key settings:
- `DATABASE_URL`: asyncpg connection string for SQLAlchemy
- `SYNC_DATABASE_URL`: psycopg2 string for Alembic and Celery (synchronous)
- `REDIS_URL`: for Celery task queue
- `GOOGLE_API_KEY`: used by both the ADK agent and the embedding model
- `JWT_SECRET`: signs access and refresh tokens
- `DASHBOARD_URL`: restricts CORS

#### `app/models/db.py` — The Database Schema
All SQLAlchemy models. Key tables:

| Table | Purpose |
|-------|---------|
| `organizations` | NGO / Hospital / Govt organizations with approval status |
| `users` | Responder accounts. Roles: ADMIN > RESPONDER > VIEWER |
| `cases` | Incoming patient triage reports |
| `soap_reports` | AI-generated SOAP notes, linked 1:1 to cases |
| `knowledge_documents` | Uploaded medical PDFs (track processing status) |
| `knowledge_chunks` | Text chunks from documents, with 384-dim pgvector embeddings |
| `knowledge_base_version` | Single row tracking the current knowledge base version |
| `practitioners` | Doctors available for appointment booking |
| `practitioner_slots` | Available booking time slots |
| `appointments` | Patient bookings (links patient + slot + case/SOAP) |

**Important design choice**: `KnowledgeChunk` stores the article's title, URL, author, and source directly on every chunk row (denormalized). This means a RAG result is fully self-contained — no second database join needed to show attribution.

**Enum columns**: All enum-typed columns use `Column(String)` in SQLAlchemy rather than `Column(Enum(PythonEnum))`. This avoids a PostgreSQL "type does not exist" error — the Python enum is used for validation in the router, but only plain strings reach the database.

#### `app/routers/cases.py` — The Ingest Route
The most important API endpoint. `POST /api/v1/cases/ingest`:
1. Reads raw bytes from request body
2. Calls `triage_pb2.LeanPayload().ParseFromString(raw_body)` to decode protobuf
3. Checks if `case_id` already exists (idempotency — safe to retry)
4. Hashes the patient's CNIC using PBKDF2 (raw CNIC never stored)
5. Creates a `Case` record in PostgreSQL
6. If triage level is RED or AMBER: enqueues `generate_soap_task.delay(case_id)` on Celery
7. Broadcasts `case:new` event to all connected dashboards via Socket.IO
8. Returns HTTP 202 Accepted

The `GET /api/v1/cases` endpoint has org-scoping built in:
- Pending cases: visible to all orgs (any responder can claim)
- Historical cases (RESOLVED, CLOSED): only visible to the org that handled them (unless ADMIN)

#### `app/agents/soap_agent.py` — The SOAP Agent
Uses Google ADK (`google.adk.agents.LlmAgent`). The agent is configured with:
- **Model**: `gemini-2.0-flash`
- **System prompt**: "Senior emergency medicine physician writing a clinical handoff note for field medics"
- **Output schema**: Pydantic `SoapOutput` class with `subjective`, `objective`, `assessment`, `plan` fields
- ADK enforces structured output — the model is required to return valid JSON matching the schema

The SOAP note is generated from the lean payload data: triage level, chief complaint, symptoms list, severity score, triage reason, and the conversation summary.

#### `app/workers/soap_worker.py` — Async Task Runner
A Celery task invoked by `generate_soap_task.delay(case_id)`. It:
1. Loads the case from PostgreSQL
2. Formats the case data as a prompt
3. Runs the Google ADK agent via a `Runner`
4. Parses the JSON output
5. Saves the `SoapReport` to the database
6. Emits `case:soap_ready` via Socket.IO so the dashboard updates in real time
7. Retries up to 3 times (60-second countdown) on failure

#### `app/workers/ingestion_worker.py` — Document Processing
When an admin uploads a medical document, this Celery task:
1. Reads the `.txt` content file
2. Reads the companion `.yaml` metadata file (title, URL, author, source)
3. Chunks the text (512 token chunks, 64 token overlap) using LangChain's `RecursiveCharacterTextSplitter`
4. Embeds all chunks using `sentence-transformers/all-MiniLM-L6-v2`
5. Saves chunks + embeddings to the `knowledge_chunks` pgvector table
6. Marks the document as ACTIVE
7. Calls `bump_version_and_export()` which:
   - Queries all ACTIVE chunks from pgvector
   - Builds a new FAISS index
   - Saves it to disk
   - Increments `knowledge_base_version.version`
8. Mobile apps detect the version bump on next launch and download the new index silently

#### `app/services/rag_service.py` — Knowledge Base Search
Used when the patient's phone has internet and the agent needs medical guidance:
1. Embeds the symptom query using `all-MiniLM-L6-v2`
2. Queries PostgreSQL's `knowledge_chunks` table using pgvector's `<=>` cosine distance operator
3. Filters to ACTIVE documents only
4. Returns top-k results with content + full attribution metadata
5. Increments `retrieval_count` on the parent document (for admin analytics)

#### PostgreSQL Tables (via Alembic)
Alembic handles schema versioning. The migration files in `alembic/versions/` must be run in order:
```bash
alembic upgrade head   # applies all pending migrations
```

Each migration file has an `upgrade()` and `downgrade()` function. The version history:
1. **0001**: Initial schema — all base tables
2. **0002**: RAG attribution columns on `knowledge_chunks`
3. **0003**: Remove `page_number` column (cleanup)
4. **0004**: Add `section_type` to chunks for smarter RAG filtering
5. **0005**: Medical guidelines download table
6. **0006**: Appointments system (practitioners, slots, bookings)

---

## 6. App 3: The Web Dashboard (Next.js)

**Location:** `apps/dashboard/`
**Framework:** Next.js 14 (App Router)
**Language:** TypeScript

### Folder Structure

```
apps/dashboard/
├── auth.ts                              ← NextAuth.js configuration
├── middleware.ts                        ← protects all /dashboard routes
├── app/
│   ├── layout.tsx                       ← root layout: theme anti-flicker script
│   ├── globals.css                      ← Tailwind base + dark/light CSS overrides
│   ├── (auth)/                          ← unauthenticated routes
│   │   ├── login/page.tsx               ← login form
│   │   └── register/page.tsx            ← org + user registration
│   └── (dashboard)/                     ← all protected routes
│       ├── layout.tsx                   ← sidebar nav, header, socket setup
│       ├── cases/
│       │   ├── page.tsx                 ← case list + map
│       │   └── [id]/page.tsx            ← case detail + SOAP viewer
│       ├── analytics/page.tsx           ← KPI cards + charts + heatmap
│       ├── appointments/page.tsx        ← incoming appointment list
│       ├── resources/page.tsx           ← medical guidelines + tools
│       ├── settings/page.tsx
│       └── admin/
│           ├── knowledge/page.tsx       ← document upload + management
│           ├── organizations/page.tsx   ← org approval workflow
│           ├── practitioners/page.tsx   ← doctor management
│           └── system/page.tsx          ← health + queue + RAG stats
├── components/
│   ├── CaseCard.tsx                     ← the RED/AMBER case card component
│   ├── CaseHistoryTable.tsx             ← past cases table with filters
│   ├── CasesMap.tsx                     ← Leaflet map with case pins
│   ├── SoapReportPanel.tsx              ← slide-over SOAP note viewer
│   ├── TriageBadge.tsx                  ← colored pill: RED/AMBER/GREEN
│   ├── ThemeProvider.tsx                ← dark/light context + localStorage
│   ├── providers.tsx                    ← wraps NextAuth + ThemeProvider
│   ├── admin/                           ← admin-specific components
│   ├── analytics/                       ← chart components (Recharts)
│   └── resources/                       ← resource card component
├── lib/
│   ├── api.ts                           ← all API call functions + TypeScript types
│   ├── socket.ts                        ← Socket.IO client singleton
│   └── dateUtils.ts
└── types/
    └── next-auth.d.ts                   ← extends Session type with org_id, role, org_type
```

### Key File Details

#### `app/(dashboard)/layout.tsx` — The Dashboard Shell
Every dashboard page renders inside this layout. It:
- Reads session from NextAuth to get role and org_type
- Builds the sidebar nav (Appointments only shows for HOSPITAL orgs)
- Admin section only shows if `role === 'ADMIN'`
- Sets up the Socket.IO connection on mount
- Registers socket event handlers:
  - `case:new` → adds to active cases list
  - `case:soap_ready` → adds SOAP badge to matching case
  - `case:claimed` → removes case from all responders' views (global broadcast)
- Contains the dark/light toggle button (Sun/Moon icon)

#### `lib/api.ts` — The API Client
A single file with a `request()` helper that:
- Attaches the JWT Bearer token from NextAuth session
- Throws on non-2xx responses (caught per-function)
- Exports typed functions: `getCases()`, `claimCase()`, `getPractitioners()`, `adminCreatePractitioner()`, etc.

#### `lib/socket.ts` — Socket.IO Client
Exports a singleton Socket.IO client. The dashboard layout calls `socket.connect()` on mount. Real-time events come through this connection without any polling.

#### `auth.ts` — NextAuth Configuration
Uses the `Credentials` provider (username/password, not OAuth). The `authorize()` function:
1. POSTs credentials to `/api/v1/auth/login`
2. On success, stores `access_token`, `user_id`, `role`, `org_id`, `org_type` in the JWT
3. These fields are added to the session object via JWT/session callbacks
4. The extended types are declared in `types/next-auth.d.ts`

#### `middleware.ts` — Route Protection
Next.js middleware that runs before every request. It:
- Checks for a valid NextAuth session
- Redirects unauthenticated users to `/login`
- Admin routes (`/admin/*`) require `role === 'ADMIN'` (enforced both here and on the API)

#### Theme System
The dashboard avoids FOUC (Flash of Unstyled Content) with a two-part solution:
1. An inline `<script>` in `app/layout.tsx` runs synchronously before React hydrates — reads `medireach_theme` from localStorage and sets `.dark` on `<html>`
2. `components/ThemeProvider.tsx` manages the React context and persists changes to localStorage

Rather than updating every page file (20+), light mode is implemented as CSS overrides in `globals.css` using `html:not(.dark)` selectors. Triage-level colors (red, amber, green) are excluded from theming — they must stay constant as safety signals.

---

## 7. How Data Flows Through the Entire System

### Flow 1: Offline Triage (No Internet)

```
Patient opens app → SplashScreen loads Phi-4 mini model (5-15 seconds)
    ↓
Registers with CNIC + phone + password → stored in SQLite
    ↓
Taps "BEGIN ASSESSMENT"
    ↓
ChatScreen opens → SymptomCollectorAgent starts
    ↓
Each patient message → SLMAdapter.chat() → response in 3-8 seconds
    ↓
Agent detects SUFFICIENT → builds MedicalFeatureVector
    ↓
TriageEngine.computeTriage(vector) → RED / AMBER / GREEN (instant, deterministic)
    ↓
For RED/AMBER: TransmissionService.sendOrCache()
    → 10-second timeout hits (server unreachable)
    → AES-256 encrypt the protobuf blob
    → INSERT into SQLite pending_payloads
    → Show "💾 Report saved — will send when signal is restored."
    ↓
Background retry loop (every 60 seconds) keeps checking
    ↓
When WiFi returns: NetworkOrchestrator detects FULL → calls flushQueue()
    → Decrypt blob → POST to /api/v1/cases/ingest
    → Delete from pending_payloads
    → transmissionStore.setLastTransmitted(caseId)
    → ChatScreen effect fires → shows "✓ Report transmitted"
    → History record in SQLite updated
```

### Flow 2: Online Triage (Full Internet)

```
Patient opens app → SLM loads as fallback, Gemini is primary LLM
    ↓
Chat runs via CloudLLMAdapter (Gemini API)
    ↓
Each message also queries server-side RAG → relevant WHO guidance appended to context
    ↓
SUFFICIENT → TriageEngine → RED/AMBER/GREEN
    ↓
TransmissionService tries POST immediately → 202 in ~200ms
    → No caching needed
    → "Report sent to emergency network."
    ↓
Server receives protobuf:
    → Decodes → CNIC hash → saves to cases table
    → Enqueues Celery task for SOAP generation (if RED/AMBER)
    → Broadcasts case:new via Socket.IO
    ↓
Celery worker runs SOAP agent (Google ADK + Gemini)
    → Generates SOAP note in 3-8 seconds
    → Saves to soap_reports table
    → Broadcasts case:soap_ready via Socket.IO
    ↓
Dashboard receives both events:
    → New case card appears
    → SOAP badge appears → responder can read the clinical note
    ↓
Responder clicks "Claim Case" → case:claimed broadcast to ALL dashboards
    → Case disappears from everyone else's queue
    → Patient receives push notification: "Help is on the way"
```

### Flow 3: Knowledge Base Update

```
Admin uploads a .txt file via dashboard (POST /api/v1/admin/knowledge/documents)
    ↓
API saves file to /uploads/, returns 202 immediately
    ↓
ingestion_worker.ingest_document_task() fires on Celery:
    → Reads companion .yaml metadata (title, URL, author, source)
    → Splits text into 512-token chunks
    → Embeds with all-MiniLM-L6-v2 → 384-dim vectors
    → Saves chunks + embeddings to knowledge_chunks (pgvector)
    → Marks document ACTIVE
    → Rebuilds FAISS index → saves to exports/knowledge_index.faiss
    → Increments knowledge_base_version.version
    ↓
Mobile apps on next launch with internet:
    KnowledgeBaseUpdateService checks GET /api/v1/knowledge/version
    → If server version > local version:
        → Downloads exports/knowledge_index.faiss (binary)
        → Saves to device's document directory
        → Updates local version in SQLite
    ↓
LocalRAG now uses the updated index for all queries
```

---

## 8. The Agentic AI Components

### What "Agentic" Means in This Project

A traditional app calls a function and gets a result. An agentic system has an AI that:
1. Observes a situation (patient's messages)
2. Decides what action to take (ask another question vs. finish)
3. Acts (sends a question back)
4. Observes the result (patient's answer)
5. Loops until a goal is reached (enough symptoms collected)

MediReach has two agents:

### Agent 1: SymptomCollectorAgent (Mobile, TypeScript)

**Why hand-written instead of a framework?**
Google ADK requires a Python runtime. The phone cannot run Python, and ADK also requires internet connectivity. So a custom loop was written in TypeScript.

**The loop:**
```
systemPrompt = "You are a triage assistant. Ask ONE question at a time..."
conversationHistory = []

while (status !== SUFFICIENT and status !== CRITICAL):
    agentMessage = LLMAdapter.chat(conversationHistory, systemPrompt)
    
    if agentMessage contains {"status":"SUFFICIENT"}:
        build MedicalFeatureVector from history
        status = SUFFICIENT
    
    elif agentMessage contains {"status":"CRITICAL","trigger":"..."}:
        status = CRITICAL → Emergency Bar appears
    
    else:
        display agentMessage to patient
        wait for patient reply
        conversationHistory.append(patientReply)
```

The system prompt tells the LLM exactly when to stop: when it has the chief complaint, onset time, severity (1-10), 2-3 associated symptoms, and allergy information. Critically, it must NOT diagnose — only collect.

**RAG integration inside the agent:**
On every iteration, the most recent patient message is also passed to `queryGuidance()`. If a relevant WHO article is found (similarity > 0.75), it is appended to the agent's context so the guidance appears inline in the chat.

### Agent 2: SOAP Generation Agent (Server, Python + Google ADK)

**Why Google ADK here?**
The server has a Python runtime, stable internet, and needs structured JSON output. ADK provides this with `output_schema=SoapOutput` — the framework enforces that the model's response matches the Pydantic schema.

**What a SOAP note is:**
- **S (Subjective)**: What the patient reported ("Patient reports 2 hours of crushing chest pain, severity 9/10")
- **O (Objective)**: Clinical observations (self-reported here, since this is field triage)
- **A (Assessment)**: Clinical interpretation ("Presentation consistent with acute coronary syndrome")
- **P (Plan)**: Immediate actions ("Priority: immediate cardiac monitoring. Transport: urgent. Resources: AED, O2")

The agent only has the lean payload: triage level, chief complaint, symptoms list, severity, triage reason, and conversation summary. It must clearly mark anything it cannot know as "[Not available — field assessment required]".

### The RAG System

**What RAG (Retrieval-Augmented Generation) does:**
Instead of relying on the AI's training data (which may be outdated or hallucinated), the app first searches a curated database of WHO emergency medicine articles, then gives the most relevant passages to the AI as context. The AI's response is grounded in real documents.

**Two-tier architecture:**

| Tier | Where | How | When |
|------|-------|-----|------|
| **Local RAG** | On device | FAISS index (binary file) + BM25 keyword search | Always (offline-capable) |
| **Server RAG** | PostgreSQL | pgvector cosine similarity | When online only |

The device always has at least the baseline FAISS index bundled at install time. Server-side RAG is richer (more documents, better filtering by section type) but requires internet.

---

## 9. Technology Choices and Trade-offs

### React Native (Mobile Framework)

**Why chosen:** Cross-platform — one codebase for Android and iOS. Expo bare workflow gives access to native modules (needed for llama.rn) while keeping the development experience fast.

**Trade-offs:**
- ✅ 70% code reuse between platforms
- ✅ Large ecosystem, active community
- ❌ Native modules (llama.rn, AES crypto) require a full APK build — cannot be tested in Expo Go
- ❌ APK builds take 15-20 minutes on EAS cloud servers
- ❌ Keyboard behavior (Fix 2 in decisions.md) required extensive iteration — Android's keyboard handling is notoriously fragmented across manufacturers

**Alternative considered:** Flutter. Rejected because Dart has fewer AI/ML native bindings and the team already knew TypeScript.

### Phi-4 Mini GGUF (On-Device SLM)

**Why chosen:** Fits in ~500MB, runs on Android 7.0+ with 3GB RAM, strong instruction-following for structured JSON output.

**Model evolution** (documented in decisions.md):
1. Llama 3.2 1B → too slow (7-10 seconds), poor structured output
2. Qwen 2.5 1.5B → better, but still inconsistent on JSON tokens
3. Phi-4 mini → current, best instruction following for this use case

**Trade-offs:**
- ✅ Fully offline, no API costs
- ✅ 500MB is manageable (modern phones have 64-128GB storage)
- ❌ 3-8 second response time (acceptable for medical triage; unacceptable for consumer chat)
- ❌ Requires download during onboarding — must manage the download UX carefully
- ❌ Cannot generate SOAP notes (too weak for long-form structured clinical text)

**Why not run SOAP generation on-device too?**
SOAP notes require clinical reasoning across the full case context. Even a 7B model struggles with this. We keep SOAP on the server where a powerful cloud LLM (Gemini) can do it properly.

### Google Gemini (Cloud LLM)

**Why chosen:** Native integration with Google ADK (no extra config). Free tier is the most generous: 15 RPM, 1M tokens/day. Strong instruction-following for structured JSON.

**Trade-offs:**
- ✅ Free tier sufficient for FYP scale
- ✅ ADK handles retries, structured output enforcement, multi-turn memory
- ✅ `gemini-2.0-flash` is fast (~2-3 seconds for SOAP generation)
- ❌ Requires internet — cannot use during full offline mode
- ❌ Google API availability is outside our control
- ❌ Data leaves the device (privacy consideration; mitigated by using CNIC hash not raw CNIC)

**Alternative considered:** Groq (llama-3.3-70b). Faster inference but less tight ADK integration and less generous free tier.

### FastAPI (Backend Framework)

**Why chosen:** Python async (matches Google ADK which is Python-native), Pydantic v2 for request validation, auto-generates OpenAPI docs, excellent async support with SQLAlchemy 2.0.

**Trade-offs:**
- ✅ Async throughout → handles concurrent ingest + SOAP generation without blocking
- ✅ Pydantic schemas serve as both runtime validation and documentation
- ✅ Native Python means Google ADK integrates with zero friction
- ❌ Python is slower than Go or Node.js for CPU-bound work (not an issue here — most work is I/O-bound or on Celery)

### PostgreSQL + pgvector (Database + Vector Store)

**Why chosen:** pgvector turns PostgreSQL into a vector database. No separate vector DB (Pinecone, Weaviate, Chroma) needed — vectors live alongside relational data in the same database instance.

**Trade-offs:**
- ✅ Single database technology to manage, backup, and scale
- ✅ Full SQL expressiveness for complex queries (joins on triage level + embedding distance in one query)
- ✅ pgvector's cosine similarity is fast for our scale (hundreds of document chunks, not millions)
- ❌ pgvector does not scale to 100M+ vectors (would need Faiss or Pinecone at that scale)
- ❌ Requires the `vector` extension to be installed on PostgreSQL

### Celery + Redis (Task Queue)

**Why chosen:** SOAP generation takes 3-8 seconds. HTTP requests should not block this long. Celery offloads these to background workers.

**Trade-offs:**
- ✅ API returns 202 Accepted instantly; SOAP appears on dashboard a few seconds later via Socket.IO
- ✅ Built-in retry logic with configurable backoff
- ✅ Redis is lightweight and easy to run in Docker
- ❌ Adds operational complexity (must run Redis + Celery worker alongside FastAPI)
- ❌ Job failures are silent unless Flower monitoring is set up

### Protocol Buffers (Payload Serialization)

**Why chosen:** A Protobuf-encoded triage payload is 800-1200 bytes. The equivalent JSON would be 3-5KB. On 2G networks where bandwidth is ~50-100 Kbps, this matters — a 1KB protobuf transmits in ~80ms vs ~350ms for JSON.

**Trade-offs:**
- ✅ Smallest possible wire format for the triage payload
- ✅ Schema-enforced — mismatched fields fail loudly
- ✅ Same `.proto` file used to generate both Python and TypeScript code
- ❌ Binary format — cannot be read without the schema
- ❌ Requires a build step to generate language-specific code (`protoc`)
- ❌ Changing field numbers (not types) breaks backwards compatibility with cached payloads

### FAISS (Mobile Vector Search)

**Why chosen:** FAISS (Facebook AI Similarity Search) is a compiled C++ library with Python and React Native bindings. It searches 384-dim vectors in microseconds even on mobile hardware.

**Trade-offs:**
- ✅ Fast enough for real-time use (sub-10ms search)
- ✅ Bundled binary is only ~2-5MB
- ✅ Can be updated without app store release (download new index file)
- ❌ Index must be fully rebuilt when any document changes (cannot update incrementally)
- ❌ `IndexFlatIP` (flat/brute-force) does not scale to millions of vectors (acceptable for our knowledge base size)

### Next.js (Dashboard Framework)

**Why chosen:** App Router with server components for fast initial load. Vercel/Netlify deployment is trivial. NextAuth.js for authentication. Tailwind CSS + shadcn/ui for rapid UI development.

**Trade-offs:**
- ✅ Server-side rendering means the dashboard loads without blank-screen flash
- ✅ Next.js App Router collocates pages + components + API routes
- ✅ NextAuth handles JWT refresh, session management, and CSRF protection
- ❌ The `.dark` class-based theming required an anti-FOUC inline script to avoid flash on load
- ❌ NextAuth session only updates after sign-out/sign-in (no hot update of org_type after session start)

### AES-256-GCM Encryption (Payload Caching)

**Why chosen:** Patients' medical data and CNIC numbers are cached in SQLite while offline. If the device is physically stolen and the SQLite file is extracted, the data must be unreadable.

**Implementation:**
- Encryption key is derived via PBKDF2 from CNIC + device fingerprint (100,000 iterations, SHA-256)
- Each payload is encrypted before INSERT into `pending_payloads`
- Decrypted only when transmitting

**Trade-offs:**
- ✅ Data at rest is protected even against physical device access
- ✅ Same `react-native-aes-crypto` library used for key derivation and encryption (no extra dependency)
- ❌ If the patient uninstalls the app, cached-but-unsent reports are permanently lost (key is derived from CNIC + device ID, unrecoverable after uninstall)
- ❌ PBKDF2 adds ~200ms to each encrypt/decrypt operation (acceptable; happens only on submission, not during chat)

### Socket.IO (Realtime Dashboard)

**Why chosen:** Dashboard responders must see new cases and SOAP notes without refreshing the page. Polling would add 1-5 second latency and unnecessary server load.

**Trade-offs:**
- ✅ Sub-second case delivery to all connected dashboards
- ✅ Room-based broadcast (`org_id` as room) scopes events to relevant responders
- ✅ `case:claimed` is broadcast globally (not org-scoped) so cases disappear everywhere the moment they are claimed
- ❌ WebSocket connections are stateful — the server must track connected clients
- ❌ Socket.IO adds the `python-socketio` + `python-engineio` dependency and the ASGI adapter layer

---

## 10. Key Files Quick Reference

**"Where is the AI conversation loop?"**
→ `apps/mobile/src/agents/SymptomCollectorAgent.ts`

**"Where is the triage classification?"**
→ `apps/mobile/src/services/triage/TriageEngine.ts`

**"Where does the phone decide to go online or use the local model?"**
→ `apps/mobile/src/services/network/NetworkOrchestrator.ts`

**"Where does the local AI model actually run?"**
→ `apps/mobile/src/services/llm/SLMAdapter.ts` (uses `llama.rn`)

**"Where is data encrypted before caching?"**
→ `apps/mobile/src/services/transmission/TransmissionService.ts`
→ `apps/mobile/src/services/encryption/AESEncryption.ts`

**"Where does the phone search the medical knowledge base offline?"**
→ `apps/mobile/src/services/rag/LocalRAG.ts`
→ `apps/mobile/src/services/rag/queryGuidance.ts` (decides server vs local)

**"Where is the medical knowledge base index stored on the phone?"**
→ `apps/mobile/src/assets/knowledge/knowledge_index.faiss`

**"Where does the server receive the patient's report?"**
→ `apps/api/app/routers/cases.py` → `POST /ingest` handler

**"Where is the SOAP note generated?"**
→ `apps/api/app/agents/soap_agent.py` (Google ADK agent definition)
→ `apps/api/app/workers/soap_worker.py` (Celery task that invokes it)

**"Where is the server-side knowledge base search?"**
→ `apps/api/app/services/rag_service.py`

**"Where are the database tables defined?"**
→ `apps/api/app/models/db.py`

**"Where are the database migrations?"**
→ `apps/api/alembic/versions/`

**"Where does the dashboard receive real-time updates?"**
→ `apps/dashboard/app/(dashboard)/layout.tsx` (socket event handlers)
→ `apps/api/app/services/socket_emitter.py` (server-side emitters)

**"Where is the dashboard login handled?"**
→ `apps/dashboard/auth.ts` (NextAuth config)
→ `apps/api/app/routers/auth.py` (login endpoint)

**"Where is the appointment booking?"**
→ Mobile: `apps/mobile/src/screens/AppointmentBookingScreen.tsx`
→ API: `apps/api/app/routers/appointments.py`
→ Admin: `apps/api/app/routers/admin/practitioners.py`
→ Dashboard: `apps/dashboard/app/(dashboard)/appointments/page.tsx`

**"Where is the shared Protobuf schema?"**
→ `proto/triage.proto` (source)
→ `apps/api/app/proto/triage_pb2.py` (Python generated)
→ `apps/mobile/src/proto/triage.ts` (TypeScript generated)

**"Where is the dark/light theme?"**
→ Mobile: `apps/mobile/src/theme/colors.ts`, `apps/mobile/src/store/themeStore.ts`
→ Dashboard: `apps/dashboard/components/ThemeProvider.tsx`, `apps/dashboard/app/globals.css`

**"What environment variables does the API need?"**
→ `apps/api/.env` (see `env-examples.txt` in root for the full list)

**"How do I run the project locally?"**
→ See `SETUP.md` in the project root, or the "Local Development Setup" section in `CLAUDE.md`

---

## 11. Shared Infrastructure

### `proto/triage.proto` — The Shared Contract

This file is the source of truth for how patient data is structured when it leaves the phone. Both the mobile app and the server generate their code from this same file.

Key fields in `LeanPayload`:
- `case_id`: UUID generated on device (used for idempotency — safe to retry)
- `patient`: name, CNIC, phone, GPS coordinates
- `chief_complaint`, `symptoms[]`, `severity`, `triage_level`, `triage_reason`
- `conversation_summary`: LLM-generated one-paragraph summary of the full chat
- `timestamp_unix`, `device_id`

### `docker-compose.yml` — Local Infrastructure

Starts two services needed for development:
```yaml
postgres:   # PostgreSQL 16 with pgvector extension
  image: pgvector/pgvector:pg16
  port: 5432

redis:      # For Celery task queue
  image: redis:7-alpine
  port: 6379
```

Run with `docker-compose up -d` before starting the API.

### i18n (Internationalization)

All user-facing strings in the mobile app have two versions:
- `apps/mobile/src/i18n/en.json` — English
- `apps/mobile/src/i18n/ur.json` — Urdu

The language is detected from the device locale via `react-native-localize`. RTL layout for Urdu is handled automatically by React Native's `I18nManager`.

---

## 12. Common Examiner Questions

**Q: What happens if the AI is wrong about the triage level?**

The triage engine is rule-based (not AI). An LLM cannot make the triage decision — it only collects symptoms. The triage rules are clinical (based on START triage protocol). Additionally, when the phone is online, the server runs a triage audit agent that can escalate the level if the symptoms warrant it.

**Q: Why not just use a regular hospital app?**

Hospital apps require internet and assume the user can reach a hospital. MediReach is designed for the gap between the disaster and the rescue — when roads are flooded, towers are down, and the patient cannot move. It works without any infrastructure.

**Q: How do you protect patient privacy?**

- The CNIC is never stored on the server in plain text — only a PBKDF2 hash
- Data cached on the device is AES-256-GCM encrypted
- The server uses HTTPS/TLS for all API calls
- Dashboard access requires organization registration and admin approval
- Role-based access: viewers cannot claim cases, responders cannot access admin functions

**Q: What is the difference between SOAP and triage?**

- **Triage** (on device) tells you urgency: who needs help first (RED > AMBER > GREEN). It is fast and deterministic.
- **SOAP** (on server) tells you what to do: a structured clinical handoff note the doctor/responder reads before treatment. Generated by AI, takes 3-8 seconds.

**Q: Why two AI models (Phi-4 and Gemini)?**

Different jobs, different constraints. Phi-4 mini runs on the phone with no internet and handles the conversation (symptom collection). Gemini is a 20B+ parameter model in the cloud that handles clinical reasoning and SOAP generation. You could not run Gemini on a phone, and you would not want to wait for a cloud LLM during a disaster when signal is gone.

**Q: What is the RAG system for?**

Without RAG, the AI gives generic advice from its training data (which may be outdated, wrong, or hallucinated). With RAG, the AI first searches a curated database of WHO emergency medicine articles, then uses the most relevant passages as context. Every response is grounded in real, attributed documents. The admin can add new documents at any time, and all devices silently update their local knowledge base index on next launch.

**Q: How does the appointment booking feature extend the product?**

During a disaster the app serves emergency triage. Between disasters it serves primary care — patients can find available doctors and book slots. The key differentiator: the doctor already has a structured SOAP note before the patient walks in, because the same AI pipeline that generates disaster triage reports generates pre-appointment clinical summaries. This is the "daily use" case that sustains the platform commercially outside of disaster season.

**Q: What would need to change for a production deployment?**

- Move file storage from `/uploads/` (local disk) to AWS S3 or MinIO
- Add rate limiting with `slowapi` on public endpoints
- Set up Flower for Celery monitoring
- Replace the self-signed SSL cert with Let's Encrypt
- Configure FCM (Firebase Cloud Messaging) for patient push notifications
- Run multiple Uvicorn workers behind Nginx (Gunicorn)
- Set up PostgreSQL connection pooling with PgBouncer
- Enable pgvector's HNSW index for faster similarity search at scale

**Q: Why Celery for SOAP generation instead of running it synchronously?**

The `/ingest` endpoint must return HTTP 202 quickly so the mobile device knows the case was received (and can delete it from the offline queue). SOAP generation takes 3-8 seconds on Gemini. Blocking the HTTP response for that long would:
1. Risk the mobile device timing out and retrying (causing duplicate cases)
2. Block the server from handling other requests during the wait
3. Delay the 202 response that clears the pending_payloads queue on the device

Celery moves the work to a background worker. The dashboard gets notified via Socket.IO when the SOAP note is ready.
