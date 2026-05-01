# CLAUDE.md — MediReach: Disaster Medical Intelligence System

## Project Overview

MediReach is an offline-first disaster response platform that bridges the intelligence gap between stranded patients and medical responders during natural calamities. It collects symptoms directly from affected individuals via a mobile application, performs on-device clinical triage, and transmits compressed SOAP reports to an NGO/hospital/government command dashboard — even in degraded or zero-connectivity environments.

The system has two distinct surfaces:
1. **Patient Mobile App** — React Native (iOS + Android), offline-capable, runs an on-device SLM
2. **Responder Web Dashboard** — Next.js web application for NGOs, hospitals, relief camps, and government agencies

---

## Technology Stack

### Mobile App
- **Framework:** React Native (Expo bare workflow) — chosen for cross-platform reach and native module access
- **Language:** TypeScript throughout
- **On-Device SLM:** Llama 3.2 1B Instruct (GGUF Q4_K_M, ~700MB) via `llama.rn` — runs on any Android 7.0+ / iOS 13+ device with 3GB+ RAM. Single model, same path on all devices, no platform branching.
- **Cloud LLM:** Google Gemini 1.5 Flash (primary) via REST API
- **Local RAG:** Baseline FAISS vector index bundled at install time (core WHO documents). On startup with internet, the app checks the server for a newer index version and downloads it silently in the background via `KnowledgeBaseUpdateService`
- **RAG Embedding (mobile):** `all-MiniLM-L6-v2` via `@xenova/transformers` (ONNX, ~25MB bundled)
- **Local Database:** SQLite via `expo-sqlite` for encrypted case cache
- **Encryption:** AES-256-GCM via `react-native-aes-crypto` for cached triage payloads
- **Network Detection:** `@react-native-community/netinfo` for real-time connectivity monitoring
- **Location:** `expo-location` for GPS coordinates (foreground + background)
- **State Management:** Zustand
- **Serialization:** Protocol Buffers (`protobufjs`) for lean payload compression

### Backend / API
- **Language:** Python 3.11+
- **Framework:** FastAPI with Pydantic v2 for request/response validation
- **Agentic Framework:** Google Agent Development Kit (`google-adk`) — orchestrates the Symptom Collector Agent and SOAP Generation Agent on the server side
- **Cloud LLM:** Google Gemini (via ADK's built-in `gemini` model provider) — see Model Selection section for exact tier
- **Database:** PostgreSQL 16 (primary data store)
- **Vector Store:** `pgvector` PostgreSQL extension — stores document chunk embeddings server-side. No separate vector DB needed; vectors live alongside relational data in the same PostgreSQL instance
- **ORM:** SQLAlchemy 2.0 (async) + Alembic for migrations
- **Document Storage:** Local filesystem (`/uploads`) in development; AWS S3 (or MinIO self-hosted) in production — stores the original uploaded PDFs
- **Realtime:** `python-socketio` with ASGI adapter for live dashboard push
- **Queue:** Celery + Redis for async SOAP generation jobs and document ingestion/embedding jobs
- **Auth:** `python-jose` for JWT (HS256) + `passlib[bcrypt]` for password hashing
- **Protobuf decoding:** `protobuf` Python package (same `.proto` definitions as mobile)
- **Environment:** Docker + docker-compose for local dev; Railway or Render for deployment
- **ASGI Server:** Uvicorn with Gunicorn workers in production

### Web Dashboard
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **UI:** Tailwind CSS + shadcn/ui components
- **Maps:** Leaflet.js with OpenStreetMap tiles
- **Charts:** Recharts
- **Realtime:** Socket.IO client
- **Auth:** NextAuth.js with JWT strategy

---

## Model Selection Guide

This section documents the recommended free-tier and open-source model choices for each role in the system. Pick one option per role and record the final decision at the bottom of this section.

### Role 1: Cloud LLM (Online Mode — Conversation + SOAP Generation)

This is the most capable model in the system. It runs on the server and handles both the symptom conversation (when the phone has signal) and SOAP report generation.

| Option | Model | Free Tier Limit | Notes |
|--------|-------|-----------------|-------|
| **Google Gemini** | `gemini-2.0-flash` | 15 RPM, 1M tokens/day | Best choice — native ADK integration, generous limits, fast |
| Groq | `llama-3.3-70b-versatile` | 14,400 req/day | Extremely fast inference, good medical reasoning |
| OpenRouter | `meta-llama/llama-3.1-8b-instruct:free` | Shared free pool | Unreliable rate limits, not recommended for prod |

**Recommendation for FYP: `gemini-2.0-flash`** — it integrates natively with Google ADK with zero extra config, the free tier is the most generous, and it has strong instruction-following for structured SOAP output.

---

### Role 2: On-Device SLM (Offline Mode — Conversation Only)

This model runs entirely on the patient's phone with no internet. It handles symptom collection when offline. It does NOT need to generate SOAP reports.

**Selected model: Llama 3.2 1B Instruct (GGUF Q4_K_M)**

| Property | Value |
|----------|-------|
| File size | ~700MB |
| RAM needed | ~1.5GB active |
| Minimum device | 3GB RAM, Android 7.0+ / iOS 13+ |
| Library | `llama.rn` (React Native llama.cpp binding) |
| Why 1B not 3B | 3B needs ~3GB RAM, excludes older/cheaper devices. For structured symptom collection with a tight system prompt, 1B is sufficient. |

**FYP presentation talking point:**
> "Due to compute constraints on disaster-affected populations' devices, we selected Llama 3.2 1B — a quantized open-source model that runs on commodity Android hardware. Future work includes training a domain-specific medical SLM fine-tuned on clinical intake data, optimized for sub-2GB deployment."

This framing shows examiners you understand the limitations and have a credible roadmap.

---

### Role 3: Embedding Model (RAG — Knowledge Base Search)

This model converts symptom text and WHO document chunks into vectors for similarity search. It runs on the device (for offline RAG) and optionally on the server (for cloud-side semantic search).

| Option | Model | Size | Dims | Notes |
|--------|-------|------|------|-------|
| **all-MiniLM-L6-v2** | Sentence-Transformers | ~25MB | 384 | Best choice for mobile — tiny, fast, well-tested for medical text |
| BGE-small-en-v1.5 | BAAI | ~33MB | 384 | Slightly better quality than MiniLM, still mobile-friendly |
| **Google text-embedding-004** | Google API | API call | 768 | Free tier via Gemini API; use this server-side only |
| nomic-embed-text-v1.5 | Nomic AI | ~137MB | 768 | Better quality but too large for mobile bundling |

**Recommendation for FYP:**
- **On-device (mobile):** `all-MiniLM-L6-v2` via `@xenova/transformers` (runs in JS via ONNX Runtime) — 25MB bundled, fast, no API calls needed
- **Server-side (if needed):** `text-embedding-004` via Google's free Gemini API — same API key as the cloud LLM, no extra setup

---

### Final Model Decisions

```
CLOUD_LLM=gemini-2.0-flash                        # Google Gemini free tier
ON_DEVICE_SLM=llama-3.2-1b-instruct-q4_k_m.gguf  # llama.rn, all Android/iOS devices
EMBEDDING_MOBILE=all-MiniLM-L6-v2                 # Bundled ONNX (~25MB)
EMBEDDING_SERVER=text-embedding-004                # Google API free tier (same key as Gemini)
```

---

## Repository Structure

```
medireach/
├── apps/
│   ├── mobile/                     # React Native (Expo) patient app
│   │   ├── src/
│   │   │   ├── agents/             # Symptom collector + triage agents
│   │   │   ├── components/         # Reusable UI components
│   │   │   ├── screens/            # Screen-level components
│   │   │   ├── services/
│   │   │   │   ├── network/        # Intelligent network orchestrator
│   │   │   │   ├── llm/            # Cloud LLM + SLM adapters
│   │   │   │   ├── rag/            # Local RAG engine (queries local FAISS index)
│   │   │   │   ├── knowledge/      # KnowledgeBaseUpdateService (checks + downloads new index)
│   │   │   │   ├── triage/         # Rule-based triage engine
│   │   │   │   ├── transmission/   # Store-and-forward dispatcher
│   │   │   │   └── encryption/     # AES-256 payload encryption
│   │   │   ├── store/              # Zustand state slices
│   │   │   ├── db/                 # SQLite schema + queries
│   │   │   ├── proto/              # Protobuf definitions + generated types
│   │   │   └── assets/
│   │   │       └── knowledge/      # Baseline WHO FAISS index (bundled at install)
│   │   └── app.json
│   │
│   ├── dashboard/                  # Next.js responder + admin dashboard
│   │   ├── app/
│   │   │   ├── (auth)/             # Login, org registration
│   │   │   ├── cases/              # Case list, detail, SOAP viewer
│   │   │   ├── analytics/          # KPI dashboard, charts, heatmap
│   │   │   ├── resources/          # Medical resource hub
│   │   │   └── admin/              # Admin-only section (role-gated)
│   │   │       ├── knowledge/      # Knowledge base document management
│   │   │       ├── organizations/  # Org approval and management
│   │   │       └── system/         # System health monitoring
│   │   ├── components/
│   │   │   ├── admin/              # Admin-specific components
│   │   │   └── ...                 # Shared components
│   │   ├── lib/
│   │   │   ├── socket.ts           # Socket.IO client
│   │   │   └── api.ts              # API client
│   │   └── public/
│   │
│   └── api/                        # FastAPI backend (Python)
│       ├── app/
│       │   ├── main.py             # FastAPI app init, middleware, socket mount
│       │   ├── routers/
│       │   │   ├── auth.py
│       │   │   ├── cases.py
│       │   │   ├── reports.py
│       │   │   ├── analytics.py
│       │   │   ├── admin/
│       │   │   │   ├── knowledge.py    # Document upload, list, delete
│       │   │   │   ├── organizations.py # Org approval, suspend
│       │   │   │   └── system.py       # Health, queue status, RAG stats
│       │   │   └── knowledge_base.py   # Public RAG query endpoint + version check
│       │   ├── agents/             # Google ADK agent definitions
│       │   │   ├── soap_agent.py
│       │   │   └── tools.py
│       │   ├── services/
│       │   │   ├── soap_generator.py
│       │   │   ├── socket_emitter.py
│       │   │   ├── notification.py
│       │   │   ├── rag_service.py      # Server-side pgvector similarity search
│       │   │   ├── document_processor.py # PDF parsing, chunking, embedding pipeline
│       │   │   └── index_exporter.py   # Regenerates + serves the mobile FAISS index
│       │   ├── workers/
│       │   │   ├── soap_worker.py
│       │   │   └── ingestion_worker.py # Async doc chunking + embedding job
│       │   ├── models/
│       │   │   ├── db.py
│       │   │   └── schemas.py
│       │   ├── core/
│       │   │   ├── config.py
│       │   │   ├── security.py
│       │   │   └── database.py
│       │   └── proto/
│       │       └── triage_pb2.py
│       ├── uploads/                # Uploaded PDF storage (dev); use S3 in prod
│       ├── alembic/
│       ├── requirements.txt
│       └── Dockerfile
│
├── proto/
│   └── triage.proto
│
├── docs/
│   └── knowledge-base/             # Seed WHO PDFs for initial baseline index build
├── docker-compose.yml
└── package.json
```

---

## Core Architecture: The Intelligence Relay

The entire system is structured as a 5-stage relay that degrades gracefully as connectivity worsens.

```
[Patient Device]  →  [Network Orchestrator]  →  [Agent Pipeline]
     ↓                      ↓                         ↓
  SLM (offline)         Cloud LLM (online)        Triage Engine
                                                       ↓
                                              [Store-and-Forward]
                                                       ↓
                                               [API Server]  →  [Dashboard]
```

### Stage 1: Intelligent Network Orchestrator

**File:** `apps/mobile/src/services/network/NetworkOrchestrator.ts`

This is a background service that runs continuously. It must be implemented first as everything else depends on it.

**Responsibilities:**
- Poll connectivity every 5 seconds using `NetInfo`
- Classify the connection as: `OFFLINE`, `DEGRADED` (2G/GPRS, latency >500ms), or `FULL`
- Expose a reactive store value (`networkMode`) consumed by all other services
- On mode change, switch the active LLM adapter transparently
- Trigger transmission queue flush when upgrading from `OFFLINE` → any connected state

**Implementation contract:**
```typescript
type NetworkMode = 'OFFLINE' | 'DEGRADED' | 'FULL';

interface NetworkOrchestrator {
  currentMode: NetworkMode;
  onModeChange: (callback: (mode: NetworkMode) => void) => () => void;
  getLLMAdapter: () => LLMAdapter; // returns CloudLLMAdapter or SLMAdapter
}
```

**Routing logic:**
- `FULL` → `CloudLLMAdapter` (Gemini 1.5 Flash via HTTPS)
- `DEGRADED` → `SLMAdapter` (on-device) for conversation; allow lean payload transmission
- `OFFLINE` → `SLMAdapter` (on-device) for everything; queue payloads locally

---

### Stage 2: LLM Adapters (Cloud + On-Device)

**Files:**
- `apps/mobile/src/services/llm/CloudLLMAdapter.ts`
- `apps/mobile/src/services/llm/SLMAdapter.ts`
- `apps/mobile/src/services/llm/LLMAdapter.interface.ts`

Both adapters must implement the same interface so agents are LLM-agnostic:

```typescript
interface LLMAdapter {
  chat(messages: ChatMessage[], systemPrompt: string): Promise<string>;
  isAvailable(): Promise<boolean>;
}
```

**CloudLLMAdapter:** Calls Gemini 1.5 Flash REST API. Include retry logic (3 attempts, exponential backoff). Respect the 60s timeout.

**SLMAdapter:** Wraps `llama.rn` (React Native binding for llama.cpp). The model file `Llama-3.2-1B-Instruct.Q4_K_M.gguf` (~700MB) is bundled in app assets and loaded once at startup. Works identically on Android 7.0+ and iOS 13+. Loading is async — show a splash screen until `isModelReady = true`. Inference takes 2–8 seconds on mid-range hardware, which is acceptable for a triage chat. In development, set `EXPO_PUBLIC_ENVIRONMENT=development` to route SLM calls to a local Ollama instance instead of the bundled model.

---

### Stage 3: Conversational Symptom Collection Agent

**File:** `apps/mobile/src/agents/SymptomCollectorAgent.ts`

This agent manages the entire chat interaction with the patient.

**Behavior:**
1. Opens with a greeting and asks for the chief complaint in simple, accessible language (Urdu/English depending on device locale)
2. Asks up to 5 clarifying questions based on the complaint (onset, severity, associated symptoms, relevant medical history, allergies)
3. Detects "critical descriptor" keywords (chest pain, difficulty breathing, uncontrolled bleeding, unconscious, seizure, snake bite, crush injury) and immediately surfaces the Emergency Notification Bar UI
4. When information is sufficient, emits a `COLLECTION_COMPLETE` event with a structured `MedicalFeatureVector`

**System prompt for the agent (must be embedded):**
```
You are a compassionate first-response triage assistant deployed in a disaster zone.
Your ONLY job is to collect patient symptoms clearly and systematically.
Do NOT diagnose. Do NOT prescribe. Do NOT reference medications by name.
Ask ONE question at a time. Use simple language.
When you have: chief complaint, onset time, severity (1-10), 2-3 associated symptoms,
and any known allergies — respond ONLY with the JSON token: {"status":"SUFFICIENT"}.
If the patient mentions: chest pain, cannot breathe, heavy bleeding, unconscious,
crush injury, or seizure — respond ONLY with: {"status":"CRITICAL","trigger":"<symptom>"}.
```

**MedicalFeatureVector schema:**
```typescript
interface MedicalFeatureVector {
  chiefComplaint: string;
  onsetTime: string;          // e.g. "2 hours ago"
  severity: number;           // 1-10
  associatedSymptoms: string[];
  allergies: string[];
  vitalSigns?: {              // optional if patient can self-report
    heartRate?: number;
    respiratoryRate?: number;
  };
  conversationSummary: string; // LLM-generated summary of full chat
  rawTranscript: ChatMessage[];
}
```

**RAG integration:**
- On every agent response, perform a vector similarity search against the local FAISS index
- If similarity score > 0.75, append relevant WHO first-aid guidance to the agent's context window
- This provides evidence-based non-diagnostic guidance inline in the chat

---

### Stage 4: Clinical Triage Engine

**File:** `apps/mobile/src/services/triage/TriageEngine.ts`

Triage is **rule-based** (not LLM-dependent) so it runs instantly and deterministically on-device. This is a safety-critical component.

**Triage logic (START Triage Protocol, simplified):**

```typescript
type TriageLevel = 'GREEN' | 'AMBER' | 'RED';

function computeTriage(vector: MedicalFeatureVector): TriageResult {
  // RED conditions (immediate life threat)
  const redKeywords = [
    'chest pain', 'heart attack', 'cannot breathe', 'difficulty breathing',
    'uncontrolled bleeding', 'haemorrhage', 'unconscious', 'unresponsive',
    'crush injury', 'amputation', 'seizure', 'snake bite', 'anaphylaxis',
    'stroke', 'paralysis', 'severe burn'
  ];

  // AMBER conditions (urgent but stable)
  const amberKeywords = [
    'fracture', 'broken', 'deep wound', 'laceration', 'fever above 39',
    'vomiting blood', 'abdominal pain severe', 'head injury', 'blunt trauma',
    'electric shock', 'drowning', 'infection severe', 'dehydration severe'
  ];

  const text = [
    vector.chiefComplaint,
    ...vector.associatedSymptoms,
    vector.conversationSummary
  ].join(' ').toLowerCase();

  if (vector.severity >= 8 || redKeywords.some(k => text.includes(k))) {
    return { level: 'RED', reason: detectReason(text, redKeywords) };
  }
  if (vector.severity >= 5 || amberKeywords.some(k => text.includes(k))) {
    return { level: 'AMBER', reason: detectReason(text, amberKeywords) };
  }
  return { level: 'GREEN', reason: 'No immediately life-threatening indicators detected.' };
}
```

**Post-triage branching:**
- `GREEN` → Display reassurance screen with WHO-sourced first aid instructions. No data transmission required.
- `AMBER` or `RED` → Build `LeanPayload`, hand off to TransmissionService

**Cloud verification (online mode only):** After local triage, if network is FULL, send the `MedicalFeatureVector` to the cloud LLM with the prompt: `"Review this symptom profile and confirm or escalate the following triage level: {level}. Respond only with: {confirmed: true/false, escalated_to: 'RED'|null, clinical_note: string}"`. If escalated, upgrade the local triage result before dispatching.

---

### Stage 5: Lean Payload & Store-and-Forward

**File:** `apps/mobile/src/services/transmission/TransmissionService.ts`

**LeanPayload Protobuf definition** (`packages/shared-proto/triage.proto`):
```protobuf
syntax = "proto3";

message PatientProfile {
  string cnic = 1;
  string name = 2;
  string phone = 3;
  double lat = 4;
  double lng = 5;
}

message LeanPayload {
  string case_id = 1;           // UUID generated on device
  PatientProfile patient = 2;
  string chief_complaint = 3;
  repeated string symptoms = 4;
  int32 severity = 5;
  string triage_level = 6;      // RED | AMBER | GREEN
  string triage_reason = 7;
  string conversation_summary = 8;
  int64 timestamp_unix = 9;
  string device_id = 10;
}
```

**Serialization:** `LeanPayload.encode(payload).finish()` produces a binary buffer. Typical size: 800–1200 bytes. This enables transmission over 2G/GPRS.

**Encryption before caching:**
```typescript
const encrypted = await AESEncrypt(
  Buffer.from(serialized).toString('base64'),
  derivedKey // PBKDF2 from user CNIC + device ID
);
await db.run(
  'INSERT INTO pending_payloads (case_id, encrypted_blob, created_at, attempts) VALUES (?, ?, ?, 0)',
  [payload.caseId, encrypted, Date.now()]
);
```

**Retry loop (background task):**
- Use `expo-background-fetch` or `expo-task-manager` to register a background task
- Every 60 seconds: check network mode, if DEGRADED or FULL, attempt to flush all `pending_payloads` where `attempts < 5`
- On successful HTTP 202 from server, delete the record from SQLite
- On failure, increment `attempts`, apply exponential backoff delay

**HTTP endpoint for submission:**
```
POST /api/v1/cases/ingest
Content-Type: application/octet-stream
Authorization: Bearer <device_jwt>
Body: <raw protobuf bytes>
```

---

## Backend API

### Database Models (SQLAlchemy)

**File:** `apps/api/app/models/db.py`

```python
from sqlalchemy import Column, String, Integer, Float, DateTime, Enum, ForeignKey, ARRAY
from sqlalchemy.orm import relationship, DeclarativeBase
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import enum, uuid

class Base(DeclarativeBase):
    pass

class OrgType(str, enum.Enum):
    NGO = "NGO"
    HOSPITAL = "HOSPITAL"
    GOVT = "GOVT"
    RELIEF_CAMP = "RELIEF_CAMP"

class OrgStatus(str, enum.Enum):
    PENDING_APPROVAL = "PENDING_APPROVAL"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"

class TriageLevel(str, enum.Enum):
    RED = "RED"
    AMBER = "AMBER"
    GREEN = "GREEN"

class CaseStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"

class DocumentStatus(str, enum.Enum):
    PROCESSING = "PROCESSING"   # uploaded, chunking/embedding in progress
    ACTIVE = "ACTIVE"           # fully indexed, live in RAG queries
    FAILED = "FAILED"           # processing failed — error_message is set
    ARCHIVED = "ARCHIVED"       # deactivated by admin, excluded from RAG queries

class Organization(Base):
    __tablename__ = "organizations"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name        = Column(String, nullable=False)
    type        = Column(Enum(OrgType), nullable=False)
    access_code = Column(String, unique=True, nullable=False)
    status      = Column(Enum(OrgStatus), default=OrgStatus.PENDING_APPROVAL)
    users       = relationship("User", back_populates="org")
    cases       = relationship("Case", back_populates="org")
    created_at  = Column(DateTime, default=datetime.utcnow)

class User(Base):
    __tablename__ = "users"
    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email         = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    # Role hierarchy: ADMIN > RESPONDER > VIEWER
    # ADMIN:     full access including all /api/v1/admin/* routes
    # RESPONDER: can view cases, claim, resolve
    # VIEWER:    read-only dashboard access
    role          = Column(String, nullable=False, default="RESPONDER")
    org_id        = Column(UUID(as_uuid=True), ForeignKey("organizations.id"))
    org           = relationship("Organization", back_populates="users")
    uploaded_docs = relationship("KnowledgeDocument", back_populates="uploaded_by_user")
    created_at    = Column(DateTime, default=datetime.utcnow)

class Case(Base):
    __tablename__ = "cases"
    id                   = Column(String, primary_key=True)
    patient_cnic_hash    = Column(String, nullable=False)
    patient_name         = Column(String, nullable=False)
    patient_phone        = Column(String, nullable=False)
    lat                  = Column(Float, nullable=False)
    lng                  = Column(Float, nullable=False)
    chief_complaint      = Column(String, nullable=False)
    symptoms             = Column(ARRAY(String), nullable=False)
    severity             = Column(Integer, nullable=False)
    triage_level         = Column(Enum(TriageLevel), nullable=False)
    triage_reason        = Column(String, nullable=False)
    conversation_summary = Column(String, nullable=False)
    soap_report          = relationship("SoapReport", back_populates="case", uselist=False)
    status               = Column(Enum(CaseStatus), default=CaseStatus.PENDING)
    claimed_by_org_id    = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    claimed_at           = Column(DateTime, nullable=True)
    received_at          = Column(DateTime, default=datetime.utcnow)
    resolved_at          = Column(DateTime, nullable=True)
    device_id            = Column(String, nullable=False)
    org_id               = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    org                  = relationship("Organization", back_populates="cases", foreign_keys=[org_id])

class SoapReport(Base):
    __tablename__ = "soap_reports"
    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id      = Column(String, ForeignKey("cases.id"), unique=True)
    case         = relationship("Case", back_populates="soap_report")
    subjective   = Column(String, nullable=False)
    objective    = Column(String, nullable=False)
    assessment   = Column(String, nullable=False)
    plan         = Column(String, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow)
    model_used   = Column(String, nullable=False)

# ── Knowledge Base Tables ──────────────────────────────────────────────────────

class KnowledgeDocument(Base):
    """
    One row per uploaded PDF. Created immediately on upload (PROCESSING).
    The Celery ingestion worker chunks + embeds it, then sets status=ACTIVE
    and bumps KnowledgeBaseVersion.version.
    """
    __tablename__ = "knowledge_documents"
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title            = Column(String, nullable=False)       # Admin-given display name
    description      = Column(Text, nullable=True)
    filename         = Column(String, nullable=False)       # Original filename
    file_path        = Column(String, nullable=False)       # Disk path or S3 key
    file_size_bytes  = Column(Integer, nullable=False)
    status           = Column(Enum(DocumentStatus), default=DocumentStatus.PROCESSING)
    chunk_count      = Column(Integer, nullable=True)       # Populated after processing
    uploaded_by      = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    uploaded_by_user = relationship("User", back_populates="uploaded_docs")
    uploaded_at      = Column(DateTime, default=datetime.utcnow)
    processed_at     = Column(DateTime, nullable=True)
    error_message    = Column(Text, nullable=True)          # Set if status=FAILED
    retrieval_count  = Column(Integer, default=0)           # Incremented by rag_service on each query
    chunks           = relationship("KnowledgeChunk", back_populates="document",
                                    cascade="all, delete-orphan")

class KnowledgeChunk(Base):
    """
    One row per text chunk extracted from a document.
    The embedding column is a 384-dim pgvector vector from all-MiniLM-L6-v2.
    RAG queries do cosine similarity search against this column.

    Metadata fields (article_title, article_url, article_author, article_source)
    are read from the companion .yaml file at ingestion time and denormalised onto
    every chunk. This means a RAG result is fully self-contained — the AI and the
    dashboard always know exactly which WHO article a chunk came from without
    needing a second database query.

    YAML metadata file format (companion file alongside every .txt content file):
        title:  "Floods: after the flood – myths and realities"
        url:    https://www.who.int/europe/publications/...
        author: World Health Organization
        source: World Health Organization (WHO)
    """
    __tablename__ = "knowledge_chunks"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id    = Column(UUID(as_uuid=True), ForeignKey("knowledge_documents.id",
                            ondelete="CASCADE"), nullable=False)
    document       = relationship("KnowledgeDocument", back_populates="chunks")
    content        = Column(Text, nullable=False)
    chunk_index    = Column(Integer, nullable=False)        # Position within document
    # From companion .yaml — denormalised for self-contained RAG results
    article_title  = Column(String, nullable=True)          # yaml: title
    article_url    = Column(String, nullable=True)          # yaml: url
    article_author = Column(String, nullable=True)          # yaml: author
    article_source = Column(String, nullable=True)          # yaml: source
    embedding      = Column(Vector(384), nullable=True)     # pgvector column
    created_at     = Column(DateTime, default=datetime.utcnow)

class KnowledgeBaseVersion(Base):
    """
    Always a single row (id=1). Version is incremented each time the
    knowledge base changes. Mobile apps compare their cached version
    against this to decide whether to download a fresh offline FAISS index.
    """
    __tablename__ = "knowledge_base_version"
    id              = Column(Integer, primary_key=True, default=1)
    version         = Column(Integer, nullable=False, default=1)
    index_file_path = Column(String, nullable=True)         # Path to latest FAISS export
    updated_at      = Column(DateTime, default=datetime.utcnow)
    document_count  = Column(Integer, default=0)
    chunk_count     = Column(Integer, default=0)
```

### Pydantic Schemas

**File:** `apps/api/app/models/schemas.py`

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class CaseIngestResponse(BaseModel):
    case_id: str
    status: str = "QUEUED"
    message: str

class CaseListItem(BaseModel):
    id: str
    triage_level: str
    status: str
    chief_complaint: str
    triage_reason: str
    lat: float
    lng: float
    received_at: datetime
    has_soap: bool

class SoapReportSchema(BaseModel):
    subjective: str
    objective: str
    assessment: str
    plan: str
    generated_at: datetime
    model_used: str

class CaseDetailResponse(CaseListItem):
    symptoms: list[str]
    severity: int
    conversation_summary: str
    soap_report: Optional[SoapReportSchema]
```

### FastAPI App Entry Point

**File:** `apps/api/app/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import socketio, os

from app.routers import auth, cases, analytics, knowledge_base
from app.routers.admin import knowledge as admin_knowledge
from app.routers.admin import organizations as admin_orgs
from app.routers.admin import system as admin_system
from app.core.config import settings

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

app = FastAPI(title="MediReach API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.DASHBOARD_URL],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes
app.include_router(auth.router,            prefix="/api/v1/auth")
app.include_router(cases.router,           prefix="/api/v1/cases")
app.include_router(analytics.router,       prefix="/api/v1/analytics")
app.include_router(knowledge_base.router,  prefix="/api/v1/knowledge")

# Admin routes (role=ADMIN enforced inside each router)
app.include_router(admin_knowledge.router, prefix="/api/v1/admin/knowledge")
app.include_router(admin_orgs.router,      prefix="/api/v1/admin/organizations")
app.include_router(admin_system.router,    prefix="/api/v1/admin/system")

# Serve exported FAISS index files as static downloads
os.makedirs(settings.FAISS_EXPORT_DIR, exist_ok=True)
app.mount("/exports", StaticFiles(directory=settings.FAISS_EXPORT_DIR), name="exports")

@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}

socket_app = socketio.ASGIApp(sio, app)
```

### Case Ingestion Route

**File:** `apps/api/app/routers/cases.py`

```python
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.db import Case, TriageLevel
from app.models.schemas import CaseIngestResponse
from app.workers.soap_worker import generate_soap_task
from app.proto import triage_pb2
import hashlib

router = APIRouter()

@router.post("/ingest", response_model=CaseIngestResponse, status_code=202)
async def ingest_case(request: Request, db: AsyncSession = Depends(get_db)):
    raw_body = await request.body()
    if len(raw_body) > 10_000:
        raise HTTPException(status_code=413, detail="Payload too large")

    # Decode protobuf
    payload = triage_pb2.LeanPayload()
    payload.ParseFromString(raw_body)

    # Idempotency: skip if case_id already exists
    existing = await db.get(Case, payload.case_id)
    if existing:
        return CaseIngestResponse(case_id=payload.case_id, status="DUPLICATE", message="Already received")

    # Hash the CNIC — never store raw
    cnic_hash = hashlib.pbkdf2_hmac("sha256", payload.patient.cnic.encode(), b"medireach_salt", 100_000).hex()

    case = Case(
        id=payload.case_id,
        patient_cnic_hash=cnic_hash,
        patient_name=payload.patient.name,
        patient_phone=payload.patient.phone,
        lat=payload.patient.lat,
        lng=payload.patient.lng,
        chief_complaint=payload.chief_complaint,
        symptoms=list(payload.symptoms),
        severity=payload.severity,
        triage_level=TriageLevel(payload.triage_level),
        triage_reason=payload.triage_reason,
        conversation_summary=payload.conversation_summary,
        device_id=payload.device_id,
    )
    db.add(case)
    await db.commit()

    # Enqueue async SOAP generation (only for RED/AMBER)
    if payload.triage_level in ("RED", "AMBER"):
        generate_soap_task.delay(payload.case_id)

    return CaseIngestResponse(case_id=payload.case_id, status="QUEUED", message="Case received")
```

### API Routes Reference

```
# Case management
POST   /api/v1/cases/ingest              # Receive protobuf payload from device
GET    /api/v1/cases                     # List cases — ?triage_level=RED,AMBER&limit=50
GET    /api/v1/cases/{id}                # Case detail + SOAP report
PATCH  /api/v1/cases/{id}/claim          # Responder claims a case
PATCH  /api/v1/cases/{id}/resolve        # Mark case resolved

# Auth
POST   /api/v1/auth/login                # Dashboard user login
POST   /api/v1/auth/refresh              # Refresh JWT
POST   /api/v1/auth/device-register      # Mobile app receives device JWT

# Analytics
GET    /api/v1/analytics/summary         # KPI cards (total, critical, avg response time)
GET    /api/v1/analytics/timeseries      # Cases over time by triage level
GET    /api/v1/analytics/symptoms        # Top symptoms frequency
GET    /api/v1/analytics/geo             # GPS coordinates for heatmap

# Knowledge base (public — used by mobile app)
GET    /api/v1/knowledge/version         # Returns current version number + document count
GET    /api/v1/knowledge/index           # Download the latest FAISS index file (binary)
POST   /api/v1/knowledge/query           # Server-side RAG query (online mode only)

# Admin — all routes require role=ADMIN in JWT
GET    /api/v1/admin/knowledge/documents            # List all documents with status
POST   /api/v1/admin/knowledge/documents            # Upload new PDF document
GET    /api/v1/admin/knowledge/documents/{id}       # Document detail + chunk count
DELETE /api/v1/admin/knowledge/documents/{id}       # Delete document + all its chunks
PATCH  /api/v1/admin/knowledge/documents/{id}/archive   # Deactivate without deleting
PATCH  /api/v1/admin/knowledge/documents/{id}/reprocess # Re-trigger ingestion on failure
GET    /api/v1/admin/knowledge/stats                # Chunk count, retrieval frequency, index size

GET    /api/v1/admin/organizations                  # List all orgs with status
PATCH  /api/v1/admin/organizations/{id}/approve     # Activate a pending org
PATCH  /api/v1/admin/organizations/{id}/suspend     # Suspend an active org

GET    /api/v1/admin/system/health                  # Server health, queue depth, DB connection
GET    /api/v1/admin/system/queue                   # Celery queue stats (pending/active jobs)
```

---

### Google ADK: Agent Definitions

Google ADK (`google-adk`) is the agentic framework used on the server side. It provides the agent loop, tool-calling, multi-turn memory, and Gemini integration out of the box. Two agents are defined on the backend.

**Why ADK on the server and not on the mobile app?**
The mobile app uses a hand-written agent loop (the `SymptomCollectorAgent`) because ADK requires network access and a Python runtime — neither of which is available offline on the device. ADK runs on the server where it has stable connectivity, full Python, and access to the powerful cloud LLM.

---

#### Agent 1: SOAP Generation Agent

**File:** `apps/api/app/agents/soap_agent.py`

This agent receives the compressed triage payload and expands it into a structured SOAP report. It uses ADK's built-in structured output capability to guarantee valid JSON.

```python
from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from pydantic import BaseModel

class SoapOutput(BaseModel):
    subjective: str
    objective: str
    assessment: str
    plan: str

SOAP_SYSTEM_PROMPT = """
You are a senior emergency medicine physician generating a clinical SOAP note
for a disaster field triage report. Your note will be read by first responders
and field medics who need to act quickly.

Rules:
- Write clearly and clinically. Avoid jargon where possible.
- Do NOT invent vitals, lab values, or findings not present in the source data.
- Mark any unknown fields as: [Not available — field assessment required]
- The Objective section must acknowledge this is a self-reported field assessment,
  not a clinical examination.
- The Plan must include: immediate intervention priority, transport urgency,
  and any resource requirements (blood, oxygen, stretcher, etc.)
"""

def create_soap_agent() -> LlmAgent:
    return LlmAgent(
        name="soap_generator",
        model="gemini-2.0-flash",   # or whichever model is in CLOUD_LLM env var
        system_prompt=SOAP_SYSTEM_PROMPT,
        output_schema=SoapOutput,   # ADK enforces structured output
        description="Generates a structured SOAP report from a triage payload",
    )
```

**Celery Worker that invokes the agent:**

**File:** `apps/api/app/workers/soap_worker.py`

```python
from celery import Celery
from google.adk.runners import Runner
from google.genai import types as genai_types
from app.agents.soap_agent import create_soap_agent, SoapOutput
from app.core.database import sync_session
from app.models.db import Case, SoapReport
from app.services.socket_emitter import emit_soap_ready
import json, os

celery_app = Celery("medireach", broker=os.getenv("REDIS_URL"))

@celery_app.task(bind=True, max_retries=3)
def generate_soap_task(self, case_id: str):
    try:
        with sync_session() as db:
            case = db.get(Case, case_id)
            if not case:
                return

            # Build the user message for the agent
            user_message = f"""
Triage Level: {case.triage_level}
Chief Complaint: {case.chief_complaint}
Reported Symptoms: {', '.join(case.symptoms)}
Severity (1-10): {case.severity}
Triage Reason: {case.triage_reason}
Conversation Summary: {case.conversation_summary}

Generate the SOAP report for this patient.
"""
            # Run the ADK agent
            agent = create_soap_agent()
            runner = Runner(agent=agent, app_name="medireach", session_service=None)
            session = runner.session_service.create_session(app_name="medireach", user_id=case_id)

            response_text = ""
            for event in runner.run(
                user_id=case_id,
                session_id=session.id,
                new_message=genai_types.Content(
                    role="user",
                    parts=[genai_types.Part(text=user_message)]
                ),
            ):
                if event.is_final_response() and event.content:
                    response_text = event.content.parts[0].text
                    break

            soap_data = json.loads(response_text)

            soap = SoapReport(
                case_id=case_id,
                subjective=soap_data["subjective"],
                objective=soap_data["objective"],
                assessment=soap_data["assessment"],
                plan=soap_data["plan"],
                model_used=os.getenv("CLOUD_LLM", "gemini-2.0-flash"),
            )
            db.add(soap)
            db.commit()

            # Push realtime event to dashboard
            emit_soap_ready(case_id, case.org_id)

    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)
```

---

#### Agent 2: Cloud-Side Triage Audit Agent (Optional — Online Mode Only)

**File:** `apps/api/app/agents/triage_audit_agent.py`

When a device submits a payload with `network_mode = FULL` (meaning it had full connectivity at submission time), the server can optionally run a triage audit to catch any under-triaged cases.

```python
from google.adk.agents import LlmAgent
from pydantic import BaseModel
from typing import Optional

class AuditOutput(BaseModel):
    confirmed: bool
    escalated_to: Optional[str]   # "RED" if escalated, else null
    clinical_note: str

AUDIT_SYSTEM_PROMPT = """
You are reviewing a field triage assessment made by a rule-based algorithm on a patient's phone.
Your job is to confirm or escalate the triage level based on the symptom profile.
Respond ONLY with the JSON schema provided. Be conservative — if in doubt, escalate.
"""

def create_audit_agent() -> LlmAgent:
    return LlmAgent(
        name="triage_auditor",
        model="gemini-2.0-flash",
        system_prompt=AUDIT_SYSTEM_PROMPT,
        output_schema=AuditOutput,
        description="Audits and optionally escalates a device-computed triage level",
    )
```

This agent is invoked synchronously inside the `/ingest` route before the case is committed to the database — only when `payload.network_mode == "FULL"`.

---

### Realtime Push (python-socketio)

**File:** `apps/api/app/services/socket_emitter.py`

```python
from app.main import sio

async def emit_new_case(case_id: str, triage_level: str, lat: float, lng: float,
                        chief_complaint: str, org_id: str):
    await sio.emit("case:new", {
        "caseId": case_id,
        "triageLevel": triage_level,
        "lat": lat,
        "lng": lng,
        "chiefComplaint": chief_complaint,
    }, room=str(org_id))

async def emit_soap_ready(case_id: str, org_id: str):
    await sio.emit("case:soap_ready", {"caseId": case_id}, room=str(org_id))

async def emit_case_claimed(case_id: str, claimed_by: str, org_id: str):
    await sio.emit("case:claimed", {"caseId": case_id, "claimedBy": claimed_by}, room=str(org_id))
```

**Acknowledgment push to device:** When a responder claims a case, FCM/APNs push is sent to the patient's device token:
```
"Help is on the way. A medical team from [OrgName] has been dispatched to your location."
```

---

### RAG Pipeline: Dynamic Server-Side Architecture

The knowledge base is **not static**. An admin uploads documents through the dashboard; the server processes them automatically; the mobile app syncs the updated index silently on next launch. No redeployment needed.

#### Document Ingestion Worker

**File:** `apps/api/app/workers/ingestion_worker.py`

When a document is uploaded via `POST /api/v1/admin/knowledge/documents`, the API saves the file and immediately enqueues a Celery job. The API returns 202 instantly — the processing happens asynchronously.

**File format:** Content files are plain `.txt`. Every `.txt` file has a companion `.yaml` file in the same directory with the same base name (e.g. `article_001_content.txt` + `article_001_metadata.yaml`). The worker reads both files — the `.txt` for content chunking, the `.yaml` for metadata that gets attached to every chunk.

**YAML metadata fields expected:**
```yaml
title:  "Floods: after the flood – myths and realities"
url:    https://www.who.int/europe/publications/m/item/...
author: World Health Organization
source: World Health Organization (WHO)
```

All four fields are optional — if the YAML file does not exist or a field is missing, the chunk is still created with `null` for that metadata field.

```python
import os, yaml
from celery import Celery
from datetime import datetime
from langchain_community.document_loaders import TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
from app.core.database import sync_session
from app.models.db import KnowledgeDocument, KnowledgeChunk, DocumentStatus
from app.services.index_exporter import bump_version_and_export

celery_app = Celery("medireach", broker=os.getenv("REDIS_URL"))

def load_yaml_metadata(txt_file_path: str) -> dict:
    """
    Given a path like /uploads/article_001_content.txt, look for
    /uploads/article_001_metadata.yaml in the same directory.
    Returns a dict with title/url/author/source keys (all may be None).
    """
    base = os.path.splitext(txt_file_path)[0]  # strip .txt
    # Handle both _content suffix and plain names
    for yaml_candidate in [
        base.replace("_content", "_metadata") + ".yaml",
        base + "_metadata.yaml",
        base + ".yaml",
    ]:
        if os.path.exists(yaml_candidate):
            with open(yaml_candidate, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            return {
                "article_title":  data.get("title"),
                "article_url":    data.get("url"),
                "article_author": data.get("author"),
                "article_source": data.get("source"),
            }
    return {"article_title": None, "article_url": None,
            "article_author": None, "article_source": None}


@celery_app.task(bind=True, max_retries=3)
def ingest_document_task(self, document_id: str):
    """
    Full pipeline: .txt → read YAML metadata → chunks → embeddings → pgvector
                   → version bump → FAISS export
    """
    try:
        with sync_session() as db:
            doc = db.get(KnowledgeDocument, document_id)

            # Step 1: Read companion YAML metadata
            metadata = load_yaml_metadata(doc.file_path)

            # Step 2: Load plain text file
            loader = TextLoader(doc.file_path, encoding="utf-8")
            pages = loader.load()

            # Step 3: Split into chunks
            # chunk_size=512 tokens ≈ ~400 words — good balance for medical text
            # chunk_overlap=64 ensures context is not lost at chunk boundaries
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=512,
                chunk_overlap=64,
                separators=["\n\n", "\n", ". ", " ", ""]
            )
            chunks = splitter.split_documents(pages)

            # Step 4: Embed each chunk using all-MiniLM-L6-v2
            embedding_model = SentenceTransformer(
                "sentence-transformers/all-MiniLM-L6-v2"
            )
            texts = [c.page_content for c in chunks]
            embeddings = embedding_model.encode(
                texts,
                show_progress_bar=False,
                batch_size=32            # process 32 chunks at a time
            )

            # Step 5: Save chunks + embeddings into pgvector
            # Metadata from YAML is denormalised onto every chunk
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                db_chunk = KnowledgeChunk(
                    document_id=document_id,
                    content=chunk.page_content,
                    chunk_index=i,
                    embedding=embedding.tolist(),
                    # Metadata from YAML — same values on every chunk of this doc
                    article_title=metadata["article_title"],
                    article_url=metadata["article_url"],
                    article_author=metadata["article_author"],
                    article_source=metadata["article_source"],
                )
                db.add(db_chunk)

            # Step 6: Mark document as ACTIVE
            doc.status = DocumentStatus.ACTIVE
            doc.chunk_count = len(chunks)
            doc.processed_at = datetime.utcnow()
            db.commit()

            # Step 7: Bump knowledge base version + export new FAISS index
            bump_version_and_export(db)

    except Exception as exc:
        with sync_session() as db:
            doc = db.get(KnowledgeDocument, document_id)
            doc.status = DocumentStatus.FAILED
            doc.error_message = str(exc)
            db.commit()
        raise self.retry(exc=exc, countdown=60)
```

#### Version Bump and FAISS Export

**File:** `apps/api/app/services/index_exporter.py`

Called after every successful ingestion, archive, or deletion. Rebuilds the FAISS index from all currently ACTIVE chunks and saves it to disk. The mobile app downloads this file when its local version is outdated.

```python
def bump_version_and_export(db):
    """
    Rebuild FAISS index from all ACTIVE chunks and update KnowledgeBaseVersion.
    Called after any change to the active document set.
    """
    import faiss, numpy as np, pickle, os

    # Fetch all active chunk embeddings from pgvector
    active_chunks = db.execute(
        select(KnowledgeChunk.id, KnowledgeChunk.content, KnowledgeChunk.embedding)
        .join(KnowledgeDocument)
        .where(KnowledgeDocument.status == DocumentStatus.ACTIVE)
    ).fetchall()

    if not active_chunks:
        return

    ids = [str(c.id) for c in active_chunks]
    texts = [c.content for c in active_chunks]
    vectors = np.array([c.embedding for c in active_chunks], dtype="float32")

    # Build FAISS flat index (cosine similarity via normalized L2)
    faiss.normalize_L2(vectors)
    index = faiss.IndexFlatIP(384)   # 384 = all-MiniLM-L6-v2 dimension
    index.add(vectors)

    # Save index + metadata
    export_dir = os.getenv("FAISS_EXPORT_DIR", "./exports")
    os.makedirs(export_dir, exist_ok=True)
    index_path = os.path.join(export_dir, "knowledge_index.faiss")
    meta_path  = os.path.join(export_dir, "knowledge_meta.pkl")

    faiss.write_index(index, index_path)
    with open(meta_path, "wb") as f:
        pickle.dump({"ids": ids, "texts": texts}, f)

    # Increment version row (always id=1)
    version_row = db.get(KnowledgeBaseVersion, 1)
    if not version_row:
        version_row = KnowledgeBaseVersion(id=1, version=1)
        db.add(version_row)
    else:
        version_row.version += 1

    version_row.index_file_path = index_path
    version_row.updated_at = datetime.utcnow()
    version_row.document_count = sum(1 for c in active_chunks if True)  # unique docs
    version_row.chunk_count = len(active_chunks)
    db.commit()
```

#### Server-Side RAG Query

**File:** `apps/api/app/services/rag_service.py`

Used by the cloud conversation agent when the patient's phone has internet. Queries pgvector directly. Returns content plus full attribution metadata from the YAML so the AI can cite its source and the dashboard can display where guidance came from.

```python
from sqlalchemy import select, text
from app.core.database import async_session
from app.models.db import KnowledgeChunk, KnowledgeDocument, DocumentStatus
from sentence_transformers import SentenceTransformer
from functools import lru_cache

@lru_cache(maxsize=1)
def get_embedding_model():
    """Load once, reuse across requests."""
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

async def query_knowledge_base(symptom_text: str, top_k: int = 3) -> list[dict]:
    """
    Embed the query and perform cosine similarity search against pgvector.
    Returns top_k most relevant chunks with full attribution metadata.

    Each result dict:
    {
        "content":        str,   # The text chunk
        "article_title":  str,   # From YAML: title
        "article_url":    str,   # From YAML: url
        "article_author": str,   # From YAML: author
        "article_source": str,   # From YAML: source
        "relevance_score": float # Cosine similarity 0-1
    }
    """
    model = get_embedding_model()
    query_vector = model.encode([symptom_text])[0].tolist()

    # Also increment retrieval_count on the parent document for admin stats
    async with async_session() as db:
        results = await db.execute(
            text("""
                SELECT
                    kc.content,
                    kc.article_title,
                    kc.article_url,
                    kc.article_author,
                    kc.article_source,
                    1 - (kc.embedding <=> :query_vector::vector) AS relevance_score,
                    kc.document_id
                FROM knowledge_chunks kc
                JOIN knowledge_documents kd ON kd.id = kc.document_id
                WHERE kd.status = 'ACTIVE'
                ORDER BY kc.embedding <=> :query_vector::vector
                LIMIT :top_k
            """),
            {"query_vector": str(query_vector), "top_k": top_k}
        )
        rows = results.fetchall()

        # Increment retrieval counts for stats tracking
        doc_ids = list({str(row.document_id) for row in rows})
        if doc_ids:
            await db.execute(
                text("""
                    UPDATE knowledge_documents
                    SET retrieval_count = retrieval_count + 1
                    WHERE id = ANY(:doc_ids::uuid[])
                """),
                {"doc_ids": doc_ids}
            )
            await db.commit()

        return [
            {
                "content":        row.content,
                "article_title":  row.article_title,
                "article_url":    row.article_url,
                "article_author": row.article_author,
                "article_source": row.article_source,
                "relevance_score": round(float(row.relevance_score), 4),
            }
            for row in rows
        ]
```

**Note:** `retrieval_count` needs to be added to the `KnowledgeDocument` model:
```python
retrieval_count = Column(Integer, default=0)   # add to KnowledgeDocument class
```
This powers the "Top retrieved documents" stat in the admin system health screen.

#### Mobile: Knowledge Base Update Service

**File:** `apps/mobile/src/services/knowledge/KnowledgeBaseUpdateService.ts`

Runs silently on every app launch when internet is available. Compares the local version stored in SQLite against the server version. If outdated, downloads the new FAISS index in the background without blocking the user.

```typescript
const LOCAL_VERSION_KEY = 'kb_local_version';

export async function checkAndUpdateKnowledgeBase(): Promise<void> {
  try {
    const network = networkStore.getState().mode;
    if (network === 'OFFLINE') return;   // can't check without signal

    // Get server version
    const response = await fetch(`${API_BASE_URL}/api/v1/knowledge/version`);
    const { version: serverVersion } = await response.json();

    // Get local version from SQLite
    const localVersion = await db.getOne(
      'SELECT value FROM app_metadata WHERE key = ?', [LOCAL_VERSION_KEY]
    );
    const local = localVersion ? parseInt(localVersion.value) : 0;

    if (serverVersion <= local) return;  // already up to date

    // Download new FAISS index in background
    const indexResponse = await fetch(`${API_BASE_URL}/api/v1/knowledge/index`);
    const indexBuffer = await indexResponse.arrayBuffer();

    // Save to app's document directory (persists across sessions)
    const indexPath = `${FileSystem.documentDirectory}knowledge_index.faiss`;
    await FileSystem.writeAsStringAsync(
      indexPath,
      Buffer.from(indexBuffer).toString('base64'),
      { encoding: FileSystem.EncodingType.Base64 }
    );

    // Update local version record
    await db.run(
      'INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)',
      [LOCAL_VERSION_KEY, serverVersion.toString()]
    );

    console.log(`Knowledge base updated: v${local} → v${serverVersion}`);
  } catch (err) {
    // Silent failure — app continues with existing index
    console.warn('Knowledge base update failed silently:', err);
  }
}
```

The local RAG engine (`LocalRAG.ts`) checks for the downloaded index file at `documentDirectory/knowledge_index.faiss` first. If it exists, it uses that. If not, it falls back to the baseline index bundled in app assets at install time. The user always has at least the baseline and silently receives improvements whenever connectivity allows.

---

### Backend Local Dev Setup

```bash
# From apps/api/
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Generate protobuf Python bindings
protoc --python_out=app/proto/ ../../proto/triage.proto

# Run Alembic migrations
alembic upgrade head

# Start API + Socket.IO server
uvicorn app.main:socket_app --reload --port 3001

# In a separate terminal: start Celery worker
celery -A app.workers.soap_worker.celery_app worker --loglevel=info
```

---

## Mobile App: Screen Architecture

### Screen 1: Splash / Onboarding
- Display app logo, tagline "Emergency Medical Assessment — Offline Ready"
- Show "OFFLINE READY" badge (green if SLM loaded, amber if loading, red if error)
- Non-Diagnostic Disclaimer modal (red-bordered) — user must explicitly acknowledge before proceeding
- Route to Registration if no user profile in SQLite, else route to Home

### Screen 2: Registration
**Fields:** Full Name, Phone Number (Pakistan format validation: +92-XXX-XXXXXXX), CNIC (XXXXX-XXXXXXX-X format validation), Current Location (auto-filled via GPS with manual override option)

**On submit:**
- Validate all fields
- Store in SQLite `users` table (local, device-only)
- Optionally sync profile to server if online (for pre-population on future device)
- Navigate to Home

### Screen 3: Home / Assessment Entry
- User greeting with name
- Network mode badge (top right): "CLOUD AI" (green) | "DEVICE AI" (amber) | "OFFLINE MODE" (red)
- Single prominent "BEGIN ASSESSMENT" button
- "My Past Assessments" link (locally stored completed cases)

### Screen 4: Symptom Chat (Core Screen)
- Dark mode chat interface, patient messages on right (teal bubbles), agent on left (dark gray)
- Typing indicator during LLM inference
- Emergency Notification Bar: slides up from bottom when `CRITICAL` status detected
  - Red background, white text: "Critical symptom detected. Emergency alert sent."
  - Below: "While you wait:" + WHO first-aid instructions from RAG
- Progress indicator (subtle dots): Collecting → Triaging → Sending
- Graceful offline message: "You are offline. Your information is being saved securely and will be sent when signal is available."

### Screen 5: Triage Result
**GREEN outcome:**
- Green background header, checkmark icon
- "No immediate emergency detected"
- Personalized first-aid and monitoring instructions (from RAG)
- "Start New Assessment" button

**AMBER / RED outcome:**
- Color-coded header (amber/red)
- "Your case has been flagged as [URGENT/CRITICAL]"
- Transmission status: "Sending to relief network..." → "Report received. Help has been alerted."
- If offline: "Stored securely. Will send when signal is available."
- Case ID displayed for reference
- Acknowledgment message when responder claims the case

---

## Web Dashboard: Screen Architecture

### Global Design
- High-contrast dark mode (default, toggle available)
- Sidebar navigation: Cases | Analytics | Resources | Settings | **Admin** (visible only when `role === 'ADMIN'`)
- Organization name + badge in header
- Real-time connection indicator (Socket.IO status)
- Admin users see an additional "Admin" section at the bottom of the sidebar with sub-items: Knowledge Base | Organizations | System Health

### Screen 1: Cases Dashboard (Primary View)
**Filter bar:** All | RED Critical | AMBER Urgent (default: RED+AMBER)
**Case card format:**
```
┌─────────────────────────────────────────────────────┐
│  🔴 CRITICAL    •  Karachi, Sindh    •  2 min ago   │
│  Chief: Chest pain with difficulty breathing         │
│  ⚠️  AI Flag: Possible acute cardiac event           │
│  [ View SOAP Report ]   [ Claim Case ]               │
└─────────────────────────────────────────────────────┘
```
- Cards sorted by triage level (RED first), then by time received
- Clicking "View SOAP Report" opens a slide-over panel with the full structured SOAP note
- Clicking "Claim Case" marks the case, notifies patient, removes from other responders' queues
- Map pin panel: Leaflet map on the right half showing all active cases as colored pins

**Case History Table (below active cases):**
Columns: Case ID | Triage | Location | Time Received | Duration | Status | Outcome
Color-coded status pills. Filterable and exportable as CSV.

### Screen 2: Analytics Dashboard
**KPI Cards (top row):**
- Total Cases (24h)
- Critical Case Count
- Avg Response Time (claim → resolve)
- Resolution Rate (%)

**Charts:**
- Line graph: Cases over time, stacked by triage level (last 24h, 7d, 30d toggle)
- Bar chart: Top 10 reported symptoms
- Geo heatmap: OpenStreetMap with Leaflet HeatLayer plugin showing case density by GPS coordinates
- Donut: Case distribution by triage level

### Screen 3: Medical Resource Hub
Grid of resource cards in four categories:

**Guidelines (download):**
- WHO Emergency Field Handbook (PDF)
- Pakistan NDMA Flood Response Protocol (PDF)
- Earthquake Trauma Management Guide (PDF)
- Pediatric Emergency Quick Reference (PDF)

**Interactive Tools:**
- Glasgow Coma Scale (GCS) Calculator — interactive scoring UI
- Pediatric Drug Dosage Calculator — weight-based dosing
- Burn Surface Area Estimator (Rule of Nines)

**Training:**
- AI System Onboarding Module — step-by-step guide with progress bar (stored in localStorage per user)

**Emergency Directory:**
- Aga Khan Hospital Emergency: 021-3493-0051
- EDHI Foundation: 115
- Pakistan Red Crescent: 1716
- NDMA Helpline: 1700

### Screen 4: Admin — Knowledge Base Management
**Access:** Visible only to users with `role === 'ADMIN'`. All other roles receive a 403 if they attempt to access `/admin/*` routes directly.

**Purpose:** Allows admins to upload new medical documents, monitor processing status, and deactivate outdated documents. Every change here automatically updates the knowledge base used by the AI and triggers a version bump that mobile apps will detect on next launch.

**Layout — two panels:**

**Left panel: Document List**
- Table showing all uploaded documents
- Columns: Title | Status badge | Chunks | Uploaded by | Upload date | Actions
- Status badges: `PROCESSING` (amber spinner) | `ACTIVE` (green) | `FAILED` (red) | `ARCHIVED` (gray)
- Actions per row: Archive | Re-process (if FAILED) | Delete
- Footer: "Knowledge Base v{version} — {n} active documents — {n} total chunks — Last updated {date}"

**Right panel: Upload New Document**
```
┌──────────────────────────────────────────────┐
│  Upload Medical Document                      │
│                                               │
│  Title: [________________________________]    │
│  Description (optional): [______________]    │
│                                               │
│  [ Drop PDF here or click to browse ]         │
│    Max size: 50MB · PDF only                  │
│                                               │
│  [ Upload and Process ]                       │
└──────────────────────────────────────────────┘
```
After upload, the new document appears immediately in the list with `PROCESSING` status. The status auto-refreshes every 5 seconds (polling `GET /api/v1/admin/knowledge/documents/{id}`) until it reaches `ACTIVE` or `FAILED`.

**Mobile sync note displayed on this screen:**
> "When a document becomes active, the knowledge base version is incremented. Mobile apps running online will silently download the updated index on their next launch."

### Screen 5: Admin — Organization Management
**Purpose:** Approve new organizations trying to register on the dashboard, and suspend organizations that should no longer have access.

**Table columns:** Organization Name | Type | Status | Users | Cases | Registered | Actions

**Actions:**
- `PENDING_APPROVAL` orgs show an **Approve** button (green) and **Reject** button (red)
- `ACTIVE` orgs show a **Suspend** button
- `SUSPENDED` orgs show a **Reactivate** button

**Approval flow:** When an organization registers on the dashboard, they land in `PENDING_APPROVAL` and cannot log in. An admin approves them, their status becomes `ACTIVE`, and their users can now log in. This prevents unauthorized access to patient case data.

### Screen 6: Admin — System Health
**Purpose:** Operational monitoring. Lets the admin see if anything is broken without needing server access.

**KPI cards:**
- API Server Status (green/red)
- Database Connection (green/red)
- Celery Worker Status (green/red) — counts active workers
- Redis Connection (green/red)

**Queue panel:** Shows pending and active Celery jobs broken down by type (SOAP generation jobs vs document ingestion jobs). Alerts if queue depth exceeds 50 (indicates worker is overwhelmed).

**RAG stats panel:**
- Total active documents
- Total indexed chunks
- Knowledge base version
- Most retrieved documents in last 7 days (shows which documents the AI is actually using)

---

## RAG System: Knowledge Base Setup

The knowledge base has two layers that work together:

**Layer 1 — Baseline bundle (at install time):**
A minimal FAISS index built from the seed articles in `Docs/knowledge_base/articles/` is shipped inside the mobile app. This is the safety net — guarantees the app has medical guidance even on a brand new install with zero internet.

**Layer 2 — Dynamic server index (managed by admin):**
All ongoing knowledge base management happens through the admin dashboard. Admins upload new `.txt` documents → server processes them via the ingestion worker → FAISS index is exported → mobile apps download the new index automatically.

---

### Folder Structure for Seed Articles

Your articles folder should be placed exactly here:

```
Docs/
└── knowledge_base/
    ├── articles/
    │   ├── article_001_content.txt      ← plain text article content
    │   ├── article_001_metadata.yaml    ← companion YAML metadata
    │   ├── article_002_content.txt
    │   ├── article_002_metadata.yaml
    │   └── ...
    └── build_baseline_index.py          ← seed script (see below)
```

**Naming convention:** Content file and its companion YAML must share the same base name with `_content` and `_metadata` suffixes. The ingestion worker detects the companion YAML automatically based on this pattern.

---

### YAML Metadata Format

Every article must have a companion `.yaml` file with exactly these four fields:

```yaml
title:  "Floods: after the flood – myths and realities"
url:    https://www.who.int/europe/publications/m/item/floods-after-the-flood---myths-and-realities
author: World Health Organization
source: World Health Organization (WHO)
```

All four fields are optional — if a field is missing the chunk is still created with `null` for that field. But having them populated means:
- The AI can cite its source when giving first-aid guidance ("According to WHO...")
- The admin stats screen shows which articles are retrieved most often
- The dashboard SOAP viewer can show which knowledge base articles influenced the AI's response

---

### Seed Script — Build Baseline Mobile Index

**File:** `Docs/knowledge_base/build_baseline_index.py`

Run this once to build the FAISS index that gets bundled into the mobile app. Re-run it whenever you add new articles to the seed folder.

```python
"""
Builds the baseline FAISS index from Docs/knowledge_base/articles/
Output goes to Apps/Mobile/src/assets/knowledge/
This index is bundled in the app at install time.
"""
import os, yaml, pickle
import numpy as np
import faiss
from langchain_community.document_loaders import TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer

ARTICLES_DIR   = "./articles"
OUTPUT_DIR     = "../../Apps/Mobile/src/assets/knowledge"
CHUNK_SIZE     = 512
CHUNK_OVERLAP  = 64

os.makedirs(OUTPUT_DIR, exist_ok=True)

embedding_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", ". ", " ", ""]
)

all_texts = []
all_metadata = []

# Process every _content.txt file in the articles folder
for filename in sorted(os.listdir(ARTICLES_DIR)):
    if not filename.endswith("_content.txt"):
        continue

    txt_path  = os.path.join(ARTICLES_DIR, filename)
    yaml_path = os.path.join(
        ARTICLES_DIR,
        filename.replace("_content.txt", "_metadata.yaml")
    )

    # Load companion YAML metadata
    meta = {"title": None, "url": None, "author": None, "source": None}
    if os.path.exists(yaml_path):
        with open(yaml_path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
            meta.update({k: loaded.get(k) for k in meta})

    # Load and chunk the text
    loader = TextLoader(txt_path, encoding="utf-8")
    docs   = loader.load()
    chunks = splitter.split_documents(docs)

    for chunk in chunks:
        all_texts.append(chunk.page_content)
        all_metadata.append({
            "article_title":  meta["title"],
            "article_url":    meta["url"],
            "article_author": meta["author"],
            "article_source": meta["source"],
            "source_file":    filename,
        })

    print(f"  Processed: {filename} → {len(chunks)} chunks")

print(f"\nTotal chunks: {len(all_texts)}")
print("Generating embeddings...")

# Embed all chunks
vectors = embedding_model.encode(
    all_texts,
    show_progress_bar=True,
    batch_size=32
).astype("float32")

# Build FAISS index
faiss.normalize_L2(vectors)
index = faiss.IndexFlatIP(384)
index.add(vectors)

# Save index and metadata
index_path = os.path.join(OUTPUT_DIR, "knowledge_index.faiss")
meta_path  = os.path.join(OUTPUT_DIR, "knowledge_meta.pkl")

faiss.write_index(index, index_path)
with open(meta_path, "wb") as f:
    pickle.dump({"texts": all_texts, "metadata": all_metadata}, f)

print(f"\nBaseline index built successfully:")
print(f"  Index: {index_path}")
print(f"  Metadata: {meta_path}")
print(f"  Chunks: {len(all_texts)}")
print(f"  Index size: {os.path.getsize(index_path) / 1024:.1f} KB")
```

**Run it:**
```bash
cd Docs/knowledge_base
pip install sentence-transformers faiss-cpu langchain langchain-community pyyaml
python build_baseline_index.py
```

The output files go directly into `Apps/Mobile/src/assets/knowledge/` and are picked up automatically by the mobile app.

**Source documents to include in your seed articles:**
- WHO Emergency Field Handbook articles
- Pakistan NDMA Disaster Medical Response Guidelines
- Pediatric Emergency Quick Reference articles
- Any other verified medical emergency guidance you have prepared

---

## Security Considerations

### Patient Data Protection
- CNIC and personal data are stored in SQLite on-device using SQLCipher encryption (via `expo-sqlite` with `encryptionKey`)
- Cached triage payloads are AES-256-GCM encrypted before storage; decryption key is derived from CNIC + device fingerprint via PBKDF2 (100,000 iterations)
- The server never stores raw CNIC values after processing — only a PBKDF2 hash for deduplication purposes
- HTTPS/TLS 1.3 enforced on all API endpoints; no plaintext transmission permitted

### Access Control
- Dashboard users authenticate via email + password (bcrypt hashed, salt 12)
- JWT access tokens expire in 15 minutes; refresh tokens in 7 days
- Role-based access: `ADMIN` can manage org users; `RESPONDER` can claim/close cases; `VIEWER` is read-only
- Organizations only see cases in their assigned geographic zone (configurable by admin)
- Device registration tokens are separate short-lived JWTs with minimal scope (ingest-only)

### API Hardening
- Rate limiting: 100 requests/minute per IP on public endpoints, 10 ingest requests/minute per device ID
- Payload size limit: 10KB on `/ingest` endpoint (protobuf payloads are <2KB; this guards against abuse)
- CORS restricted to dashboard domain in production
- Helmet.js headers on all Express responses

---

## Internationalization (i18n)

The mobile app must support both **English** and **Urdu** as primary languages.

- Use `i18next` with `react-i18next`
- Language detection from device locale (`RNLocalize`)
- All agent prompts must be localized — maintain separate system prompt files for `en` and `ur`
- RTL layout support for Urdu via React Native's built-in RTL handling (`I18nManager.forceRTL`)
- Urdu font: Noto Nastaliq Urdu (bundle with app)

**Minimum localized strings:**
- All UI labels, buttons, status messages
- Triage result explanations
- Non-diagnostic disclaimer
- Emergency notification bar copy
- First-aid instruction templates

---

## Environment Variables

### API Server (`apps/api/.env`)
```
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/medireach
SYNC_DATABASE_URL=postgresql://user:pass@localhost:5432/medireach
REDIS_URL=redis://localhost:6379/0
GOOGLE_API_KEY=your_gemini_api_key        # Used by ADK + embedding model
CLOUD_LLM=gemini-2.0-flash               # Override to switch models
JWT_SECRET=your_jwt_secret_min_32_chars
DASHBOARD_URL=http://localhost:3000
FCM_SERVER_KEY=your_firebase_server_key
APNS_KEY_PATH=./certs/apns.p8
ENVIRONMENT=development                   # development | production
PORT=3001
```

### Mobile App (`apps/mobile/.env`)
```
EXPO_PUBLIC_API_BASE_URL=https://api.medireach.app
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
EXPO_PUBLIC_ENVIRONMENT=production
```

### Dashboard (`apps/dashboard/.env.local`)
```
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=https://dashboard.medireach.app
NEXT_PUBLIC_API_URL=https://api.medireach.app
NEXT_PUBLIC_SOCKET_URL=https://api.medireach.app
```

---

## Local Development Setup

```bash
# Prerequisites: Node 20+, Python 3.11+, Docker, Expo CLI

# 1. Start infrastructure
docker-compose up -d postgres redis

# 2. Backend (FastAPI)
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
protoc --python_out=app/proto/ ../../proto/triage.proto   # generate protobuf bindings
alembic upgrade head                                        # run migrations
uvicorn app.main:socket_app --reload --port 3001 &
celery -A app.workers.soap_worker.celery_app worker --loglevel=info &

# 3. Dashboard (Next.js)
cd apps/dashboard
npm install && npm run dev   # runs on port 3000

# 4. Mobile (React Native / Expo)
cd apps/mobile
npm install && npx expo run:android   # physical device preferred for SLM testing

# 5. Build RAG index (one-time — only needed when source PDFs change)
cd docs/knowledge-base
pip install langchain langchain-community faiss-cpu sentence-transformers pypdf
python build_index.py
```

**Testing the SLM locally:** Gemini Nano requires a physical Android device (Pixel 6+, Samsung S22+, Android 14+). For emulator testing, add an env flag `EXPO_PUBLIC_ENVIRONMENT=development` and the `SLMAdapter` will route to a local Ollama instance (`http://localhost:11434`, model: `llama3.2:3b`) instead of the on-device model.

---

## Development Phases & Task Priority

### Phase 1 — Foundation (Weeks 1-2)
1. Set up repo structure (mobile + dashboard as JS workspaces; api as standalone Python project)
2. Build `NetworkOrchestrator` service with unit tests
3. Implement `LLMAdapter` interface + `CloudLLMAdapter`
4. Build `TriageEngine` with full test coverage (this is safety-critical — 100% branch coverage required)
5. Define SQLAlchemy models, write initial Alembic migration, verify schema applies cleanly
6. Implement `/ingest` FastAPI route with protobuf decoding and idempotency check
7. Confirm Google ADK installs correctly and `create_soap_agent()` can call Gemini free tier

### Phase 2 — Core Mobile Flow (Weeks 3-4)
1. Build Registration screen with CNIC + phone validation
2. Implement `SymptomCollectorAgent` with the 5-question flow
3. Integrate `LocalRAG` with pre-built FAISS index
4. Build triage result screens (GREEN / AMBER / RED)
5. Implement `TransmissionService` with SQLite cache + retry loop
6. Integrate `SLMAdapter` (llama.cpp binding)

### Phase 3 — Dashboard & Realtime (Weeks 5-6)
1. Build cases list with real-time Socket.IO updates
2. Implement Leaflet geospatial map with case pins
3. Build SOAP report viewer (slide-over panel)
4. Implement case claim + acknowledgment push flow
5. Build analytics charts (Recharts)

### Phase 4 — Polish & Resilience (Week 7)
1. Add Urdu i18n support + RTL layout
2. Implement Celery SOAP worker + Flower dashboard for queue monitoring (`pip install flower`)
3. Security audit: rate limiting (`slowapi`), CNIC hashing, AES encryption verification
4. Build Medical Resource Hub screen
5. End-to-end test: simulate full offline → reconnect → dashboard flow
6. Performance: measure protobuf payload sizes, SLM inference latency, ADK agent round-trip time

---

## Key Constraints & Non-Negotiables

1. **The triage engine is rule-based and deterministic.** LLM may audit it but must never be the sole decision-maker for triage level. Safety-critical path must not depend on network availability.

2. **The app must be fully functional with zero internet.** Every user-facing feature except dashboard delivery must work offline. Test on airplane mode from the first integration.

3. **Non-Diagnostic Disclaimer is mandatory.** The disclaimer must appear before the user begins any assessment and must require explicit acknowledgment. Do not allow it to be dismissed automatically.

4. **Patient data never leaves the device in plaintext.** All cached payloads are AES-256 encrypted. The protobuf payload sent over the network contains no more PII than strictly necessary for triage dispatch (name, CNIC hash, GPS, symptoms).

5. **The lean payload must be under 2KB.** Test serialized payload size during development. If it grows beyond this, remove fields from the mobile → server transmission (the SOAP generator on the server can reconstruct from a good summary).

6. **The dashboard is for medical responders, not patients.** Dashboard access is gated behind organization registration. There is no self-service signup for the dashboard.

7. **GPS coordinates are required before any assessment begins.** If GPS is unavailable, prompt the user to enable location. Do not allow triage without coordinates — the dispatch system is useless without location.
