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

## Reverted Decisions

<!-- Move entries here if a decision was reversed, and document why. -->
