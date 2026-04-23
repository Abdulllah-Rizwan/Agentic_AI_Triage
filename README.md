# Agentic AI Triage — Disaster Medical Intelligence System

An offline-first mobile platform that collects symptoms from disaster-affected patients, performs clinical triage on-device, and transmits compressed SOAP reports to an NGO/hospital command dashboard — even over 2G/GPRS or with no internet at all.

---

## What This System Does

1. A patient in a disaster zone opens the mobile app on their phone
2. They describe their symptoms to an AI chat agent
3. The app classifies their condition as RED (critical), AMBER (urgent), or GREEN (minor) — this works fully offline
4. A compressed report (~800 bytes) is sent to the server when any signal is available
5. Doctors and NGO workers see the patient's location, symptoms, and a full SOAP report on a live dashboard

---

## The Three Parts

| Part | What it is | Where it lives |
|------|-----------|----------------|
| **Mobile App** | React Native patient app | `apps/mobile/` |
| **API Server** | Python FastAPI backend | `apps/api/` |
| **Dashboard** | Next.js web app for responders | `apps/dashboard/` |

---

## Documentation Map

Read these files in order when starting development. Claude Code reads them automatically when working in those folders.

| File | What it covers |
|------|---------------|
| `CLAUDE.md` | Full architecture, tech stack, all agent logic, security rules |
| `DECISIONS.md` | Why specific choices were made; what was tried and rejected |
| `apps/mobile/CLAUDE.md` | Offline state machine, SLM lifecycle, SQLite schema, screen flow |
| `apps/api/AGENTS.md` | How ADK agents work, how to test them, what good output looks like |
| `apps/api/README.md` | How to run the backend, common errors, env vars |
| `apps/mobile/README.md` | How to run the mobile app, SLM setup, emulator vs device |
| `apps/dashboard/README.md` | How to run the dashboard, login setup |
| `proto/SCHEMA.md` | Protobuf schema, field size limits, how to regenerate bindings |

---

## Quick Start (Full System)

### Prerequisites
- Python 3.11+
- Node.js 20+
- Docker Desktop
- Android Studio (for emulator) OR a physical Android phone
- A Google AI API key — get one free at https://aistudio.google.com

### 1. Start infrastructure
```bash
docker-compose up -d
```

### 2. Start the API server
```bash
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:socket_app --reload --port 3001
```

### 3. Start the Celery worker (in a separate terminal)
```bash
cd apps/api && source .venv/bin/activate
celery -A app.workers.soap_worker.celery_app worker --loglevel=info
```

### 4. Start the dashboard
```bash
cd apps/dashboard
npm install && npm run dev
# Open http://localhost:3000
```

### 5. Start the mobile app
```bash
cd apps/mobile
npm install && npx expo run:android
```

---

## IDE Setup

**Use VS Code or Cursor for everything.** You do not write code in Android Studio.

Android Studio is only needed for its emulator. Once the emulator is set up, close Android Studio and do all coding in VS Code/Cursor.

**Recommended VS Code extensions:**
- Python (Microsoft)
- Pylance
- React Native Tools
- ESLint
- Prettier
- SQLite Viewer (for inspecting the mobile SQLite database)
- Thunder Client (for testing API endpoints without Postman)

---

## Technology Summary

| Layer | Technology |
|-------|-----------|
| Mobile framework | React Native (Expo) |
| Mobile language | TypeScript |
| On-device AI | Llama 3.2 1B via `llama.rn` |
| Cloud AI | Gemini 2.0 Flash (free tier) |
| Agentic framework | Google ADK (Python, server-side) |
| Embedding model | all-MiniLM-L6-v2 (mobile), text-embedding-004 (server) |
| Knowledge base | WHO Emergency Handbook via FAISS |
| Payload format | Protocol Buffers (~800 bytes per triage report) |
| Backend framework | FastAPI (Python) |
| Database | PostgreSQL + SQLAlchemy |
| Background jobs | Celery + Redis |
| Realtime push | python-socketio |
| Dashboard framework | Next.js 14 |
| Dashboard UI | Tailwind CSS + shadcn/ui |
| Maps | Leaflet.js + OpenStreetMap |

---

## FYP Presentation Notes

**On the SLM choice:** "We selected Llama 3.2 1B, a quantized open-source model deployable on commodity Android hardware. Its compact size (700MB) ensures accessibility across the socioeconomic profile of disaster-affected populations. Future work includes fine-tuning a domain-specific medical SLM on clinical intake data."

**On offline-first design:** "Communication infrastructure is typically the first casualty of a disaster. All triage logic runs on-device and payloads are encrypted and cached locally. The system transmits only when signal is available — a store-and-forward architecture that ensures no assessment is ever lost."

**On SOAP reports:** "A compressed 800-byte payload containing structured symptom data is transmitted to the server, where a powerful cloud LLM expands it into a clinical SOAP note. This separation allows a low-bandwidth transmission with a high-quality clinical output."
