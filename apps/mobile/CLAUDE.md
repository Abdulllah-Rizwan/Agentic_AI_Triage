# CLAUDE.md — Agentic AI Triage Mobile App (Supplementary)

This file supplements the root CLAUDE.md with mobile-specific detail. Read the root CLAUDE.md first for overall architecture. This file covers: the offline state machine, the SLM loading lifecycle, the SQLite schema as actually implemented, and the exact screen flow.

---

## The Three-Mode State Machine

The app is always in one of three modes. Everything routes through this — which LLM to call, whether to send or cache, what to show in the UI.

```
┌─────────────┐         signal restored         ┌──────────────┐
│   OFFLINE   │ ─────────────────────────────→  │   DEGRADED   │
│             │ ←─────────────────────────────  │  2G / GPRS   │
└─────────────┘        signal drops              └──────────────┘
       │                                                │
       │ no signal at all              full broadband   │
       │                                                ↓
       └──────────────────────────────────────→ ┌──────────────┐
                                                 │    FULL      │
                                                 │  WiFi / 4G   │
                                                 └──────────────┘
```

| Mode | LLM Used | Transmission | UI Badge |
|------|----------|-------------|----------|
| FULL | Gemini API (cloud) | Send immediately | 🟢 CLOUD AI |
| DEGRADED | Llama 3.2 1B (device) | Send (lean payload fits in 2G) | 🟡 DEVICE AI |
| OFFLINE | Llama 3.2 1B (device) | Cache encrypted, retry later | 🔴 OFFLINE MODE |

**Rules:**
- Mode transitions happen in `NetworkOrchestrator`. No other service changes mode.
- When transitioning from OFFLINE or DEGRADED → FULL, `TransmissionService.flushQueue()` is called automatically.
- The UI badge updates reactively from the Zustand store — no manual polling in components.

---

## SLM Loading Lifecycle

The Llama model is 700MB. It cannot be loaded instantly. This lifecycle must be respected:

```
App starts
    ↓
SplashScreen shown
    ↓
SLMAdapter.initialize() called (loads model into memory, ~5-15 seconds)
    ↓
NetworkOrchestrator.start() called (begins polling connectivity)
    ↓
Both ready?
    ├── Yes → Navigate to Registration or Home
    └── No (after 30s timeout) → Show error: "Device AI unavailable. Cloud mode only."
         └── App continues in FULL mode only (disable offline features)
```

**Implementation notes:**
- Call `SLMAdapter.initialize()` and `NetworkOrchestrator.start()` in parallel with `Promise.all()` — do not await them sequentially.
- Store `isSLMReady: boolean` in Zustand. Components check this before calling `SLMAdapter.chat()`.
- If `isSLMReady` is false and network is OFFLINE, do not attempt to start a chat. Show: "Device AI is still loading. Please wait."
- The model must be loaded before the user reaches the chat screen. The splash screen loading is the loading gate.

---

## SQLite Schema (Actual Implementation)

Three tables. All created on first app launch via a migration in `db/migrations.ts`.

```sql
-- Stores the registered user profile (only one row ever)
CREATE TABLE IF NOT EXISTS user_profile (
  id            TEXT PRIMARY KEY DEFAULT 'local_user',
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  cnic          TEXT NOT NULL,           -- stored locally in plaintext; only HASH sent to server
  lat           REAL,
  lng           REAL,
  registered_at INTEGER NOT NULL         -- unix timestamp
);

-- Cached triage payloads waiting to be sent
CREATE TABLE IF NOT EXISTS pending_payloads (
  case_id       TEXT PRIMARY KEY,        -- UUID, matches LeanPayload.case_id
  encrypted_blob TEXT NOT NULL,          -- AES-256-GCM encrypted base64 string
  triage_level  TEXT NOT NULL,           -- RED | AMBER | GREEN (for UI display without decrypting)
  created_at    INTEGER NOT NULL,        -- unix timestamp
  attempts      INTEGER DEFAULT 0,       -- number of send attempts so far
  last_attempt  INTEGER                  -- unix timestamp of last attempt
);

-- Completed assessments shown in "My History"
CREATE TABLE IF NOT EXISTS completed_cases (
  case_id       TEXT PRIMARY KEY,
  triage_level  TEXT NOT NULL,
  chief_complaint TEXT NOT NULL,
  completed_at  INTEGER NOT NULL,
  acknowledged  INTEGER DEFAULT 0        -- 1 if responder sent "help is coming" notification
);
```

**Important constraints:**
- `pending_payloads.attempts` must never exceed 5. After 5 failed attempts, move the record to `completed_cases` with triage_level preserved and log a warning.
- `user_profile` always has exactly one row. Use `INSERT OR REPLACE` when saving registration.
- Never store raw CNIC in `pending_payloads` — the encrypted_blob contains the full `LeanPayload` protobuf including CNIC. That is acceptable because it is AES-256 encrypted. The `triage_level` field is stored plaintext for UI display only.

---

## Encryption Key Derivation

The key used to encrypt each payload is derived deterministically from the user's CNIC and device ID:

```typescript
import { pbkdf2 } from 'react-native-quick-crypto';

async function deriveEncryptionKey(cnic: string, deviceId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(
      `${cnic}:${deviceId}`,    // password
      'medireach_payload_salt', // salt (fixed — acceptable for this use case)
      100000,                   // iterations
      32,                       // key length (256 bits)
      'sha256',
      (err, key) => err ? reject(err) : resolve(key)
    );
  });
}
```

This means:
- The same device + CNIC always produces the same key
- If the app is uninstalled and reinstalled, the old encrypted records are unrecoverable (which is fine — they were never sent)
- The encryption is for data at rest, not identity verification

---

## Transmission Retry Loop

The retry loop runs as a background task. Here is the exact logic:

```typescript
// TransmissionService.ts — startRetryLoop()

const RETRY_INTERVAL_MS = 60_000;  // check every 60 seconds
const MAX_ATTEMPTS = 5;

async function startRetryLoop() {
  setInterval(async () => {
    const mode = networkStore.getState().mode;
    if (mode === 'OFFLINE') return;  // don't try if no signal

    const pending = await db.all(
      'SELECT * FROM pending_payloads WHERE attempts < ? ORDER BY created_at ASC',
      [MAX_ATTEMPTS]
    );

    for (const record of pending) {
      try {
        const key = await deriveEncryptionKey(userProfile.cnic, deviceId);
        const decrypted = await AESDecrypt(record.encrypted_blob, key);
        const payloadBytes = Buffer.from(decrypted, 'base64');

        await fetch(`${API_BASE_URL}/api/v1/cases/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: payloadBytes,
        });

        // Success — remove from queue, add to history
        await db.run('DELETE FROM pending_payloads WHERE case_id = ?', [record.case_id]);
        await db.run(
          'INSERT OR IGNORE INTO completed_cases (case_id, triage_level, chief_complaint, completed_at) VALUES (?, ?, ?, ?)',
          [record.case_id, record.triage_level, '...', Date.now()]
        );
      } catch {
        await db.run(
          'UPDATE pending_payloads SET attempts = attempts + 1, last_attempt = ? WHERE case_id = ?',
          [Date.now(), record.case_id]
        );
      }
    }
  }, RETRY_INTERVAL_MS);
}
```

---

## Emergency Notification Bar

The Emergency Notification Bar appears at the bottom of the chat screen when the `SymptomCollectorAgent` returns `{"status":"CRITICAL","trigger":"..."}`.

**Rules:**
- It slides up from the bottom — it does NOT replace the chat
- It has a red background (`#DC2626`) with white text
- It shows two things: (1) "Emergency alert sent — help is being notified" and (2) the first-aid instruction from RAG for the detected trigger symptom
- It cannot be dismissed by the user — it stays until the triage result screen is shown
- Even if the network is OFFLINE, the bar must appear — the message is "Your information has been saved and will be sent when signal is available"

---

## Screens and Navigation

The navigation stack (React Navigation):
```
Root
├── SplashScreen (no back navigation)
├── Auth Stack
│   └── RegistrationScreen
└── Main Stack (after registration)
    ├── HomeScreen
    ├── ChatScreen
    └── TriageResultScreen
```

**Navigation rules:**
- `SplashScreen` → `RegistrationScreen` only if SQLite `user_profile` table is empty
- `SplashScreen` → `HomeScreen` if user is already registered
- `ChatScreen` → `TriageResultScreen` is one-way — the back button must be disabled on `ChatScreen` once triage is computed (to prevent re-submission)
- `TriageResultScreen` has a "Start New Assessment" button that navigates back to `HomeScreen` and clears the current chat session from state

---

## What Claude Code Should NOT Change

1. The triage keyword lists in `TriageEngine.ts` — these are clinically derived. Changes require medical review.
2. The system prompt in `SymptomCollectorAgent.ts` — it has been carefully worded. Do not rephrase without testing.
3. The AES encryption and PBKDF2 key derivation — security-critical, changes break existing cached records.
4. The protobuf field numbers in `triage.proto` — changing field numbers breaks backwards compatibility with already-cached payloads.
