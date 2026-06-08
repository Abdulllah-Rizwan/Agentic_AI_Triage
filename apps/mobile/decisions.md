# Mobile App — Decisions & Fixes Log

## Session: 2026-05-24

---

### Fix 1: Chat Session Persisting After Triage Completion

**Problem**
After a triage assessment finished (guidance shown, "Start New Assessment" button appeared), if the user closed the chat without pressing the button and re-opened it from the Home screen, the old completed conversation was restored. The user could type into it but the agent had no memory of the previous symptoms — it responded as if starting fresh despite showing the old messages.

**Root Cause**
`_handlePostTriage` (step 6) saved a "completed" session to SQLite with `hasCompletedTriage: true`. However, the save-effect (which fires on every `addMessage` call throughout the triage pipeline) was writing the session WITHOUT the `hasCompletedTriage` flag — and because `_handlePostTriage` is async, the save-effect writes happened after the guidance message was added but before the completed-session write. The last write to SQLite won, and it did not carry `hasCompletedTriage: true`. On next open, the session was treated as in-progress: old messages were restored, the agent was restored to its end state, but `setHasCompletedTriage(true)` was never called, so the input box appeared and the agent responded without context.

**Fix — `apps/mobile/src/screens/ChatScreen.tsx`**
Replaced the "save completed session" block in `_handlePostTriage` step 6 with a simple `clearActiveSession()` call. The chat history and completed-case record are already written to their own SQLite tables earlier in the pipeline. Clearing the active session slot means the next "BEGIN ASSESSMENT" finds no session and always starts a fresh chat. No race conditions possible.

```
Before: saveActiveSession({ ...completedSession, hasCompletedTriage: true })
After:  clearActiveSession()
```

---

### Fix 2: Input Field Hidden Behind Keyboard

**Problem**
When the user tapped the input field in the Chat screen and the keyboard opened, the input field did not lift up — it stayed behind the keyboard. The user was typing without being able to see the input field.

**Root Cause (and iteration history)**
This went through several iterations before the correct fix was found:

| Attempt | `softwareKeyboardLayoutMode` | KAV `behavior` | Result |
|---------|------------------------------|----------------|--------|
| Original | `"pan"` | `"padding"` | Input visible but large gap above keyboard (double-adjustment) |
| Attempt 2 | `"pan"` | `undefined` | Input hidden — `adjustPan` alone did not pan enough on Samsung One UI |
| Attempt 3 | `"nothing"` | `undefined` + manual `paddingBottom: keyboardHeight` | Input hidden — `keyboardDidShow` never fired on older Android with `adjustNothing`, height stayed 0 |
| Attempt 4 | `"resize"` | `undefined` + manual padding | Double-adjustment: window resize AND manual padding both shrank content |
| Attempt 5 | `"resize"` | `undefined`, `flex:1` on FlatList | Worked in **Expo Go** (Expo Go's host activity already has `adjustResize`). **Broke in APK** — `adjustResize` is unreliable on Android 11+ edge-to-edge windows. |
| **Final fix** | `"nothing"` | `"height"` (Android), `"padding"` (iOS) | KAV handles height via Android's modern WindowInsets API. No double-adjustment because native does nothing. |

**Why Expo Go and APK behaved differently (important):**
Expo Go's host activity has its own `windowSoftInputMode` (`adjustResize`) baked into Expo Go itself. Our `app.json` setting only applies to the **built APK**, not Expo Go. So a fix can appear to work in Expo Go but fail in the APK if it relies on `adjustResize`. Never use Expo Go to validate keyboard behaviour — always verify in an APK build.

**Fix — `apps/mobile/app.json`**
```json
"softwareKeyboardLayoutMode": "nothing"
```
Disables all native keyboard adjustment. KAV takes full control via keyboard events.

**Fix — `apps/mobile/src/screens/ChatScreen.tsx`**
- `KeyboardAvoidingView` uses `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` — on Android, KAV reduces its own height by the keyboard height via the WindowInsets API (Android 11+).
- `FlatList` has `style={styles.flex1}` — required so FlatList shrinks when KAV height shrinks.
- Input row `paddingBottom` logic: `Platform.OS === 'android' && keyboardVisible ? 0 : 12 + insets.bottom` — zeroes out the nav-bar inset while the keyboard is up.
- `keyboardDidShow` / `keyboardDidHide` listeners track `keyboardVisible`. These fire with `"nothing"` on Android 11+ via WindowInsets API (unlike older Android where `"nothing"` silenced them).

**Requires native rebuild** — `softwareKeyboardLayoutMode` is written into `AndroidManifest.xml` at build time. Must run `eas build --platform android --profile preview`.

---

### EAS Build Account Rotation

**Context**
The primary EAS account (`abdullahrizwan354`) exhausted its free Android build quota for the month.

**Resolution**
Switched to a secondary EAS account (`abdullah_expo`) with a fresh free tier quota.

**Changes to `apps/mobile/app.json`**
```json
"owner": "abdullah_expo",
"extra": {
  "eas": {
    "projectId": "bf990b61-5cab-4039-a2cc-0eeed7d63dae"
  }
}
```

**Process for future account rotation**
1. `eas logout`
2. `eas login` (log in with new account)
3. Update `owner` in `app.json` to new account username
4. Clear `projectId` under `extra.eas`
5. `eas init` — creates a new project under the new account and writes the correct `projectId`
6. `eas build --platform android --profile preview`

Note: the `preview` profile in `eas.json` builds a standalone APK for internal distribution (not a development client). It does not support Metro hot reload. JS-only changes can be tested via Metro on a previous build; native config changes (`app.json`) always require a full rebuild.

---

## Session: 2026-05-25

---

### Fix 3: APK Not Updating — Android Signature Mismatch

**Problem**
After switching the EAS build account from `abdullahrizwan354` to `abdullah_expo` (previous session), installing the new APK failed silently with the message: **"App not installed as package conflicts with an existing package."** The old version of the app continued running on the device. All fixes from the previous two sessions appeared not to work — because the old unsigned build was still installed.

**Root Cause**
Android ties each installed app to the signing key used to build it. Each EAS account uses a different signing keystore. When you install an APK signed with a different key than the one already on the device, Android refuses the install with the conflict error. No prompt is shown — the install silently fails and the old app remains.

**Fix**
Uninstall the old app from the device before installing the new APK. This is required **every time the EAS account changes** (or whenever the signing key changes).

```
Settings → Apps → MediReach → Uninstall
```

Then install the new APK normally (via adb or browser download).

**Rule going forward:** Whenever a new EAS account is used for the first time, the previous build must be uninstalled before the new APK is installed. All subsequent builds from the same account install as updates without uninstalling.

---

### Fix 4: Online Mode (Cloud AI) Failing Silently in APK

**Problem**
In the APK build (preview profile), starting an assessment in online mode showed "having trouble connecting" or fell through to offline mode immediately. No error was visible in server logs.

**Root Cause**
`EXPO_PUBLIC_GROQ_API_KEY` was present in `apps/mobile/.env` (used for local Expo Go testing) but `.env` files are **never sent to EAS cloud build servers** — they are gitignored. The EAS preview profile was missing the key entirely. Every Groq API call from the APK returned HTTP 401, which the `CloudLLMAdapter` treated as a network failure.

Server logs didn't show the error because Groq is an external API called directly from the device — errors never appear in the local API server logs.

**Fix**
Add the Groq key as an EAS secret (not a dashboard env var — secrets are the preferred method for sensitive keys):

```powershell
eas secret:create --scope project --name EXPO_PUBLIC_GROQ_API_KEY --value gsk_your_key_here
```

Secrets set this way are injected at build time into all profiles automatically. No dashboard UI step needed.

**Distinction:** `eas.json` `env` section (for non-sensitive vars like `EXPO_PUBLIC_ENVIRONMENT`) vs EAS secrets (for API keys, tokens). Never put API keys in `eas.json` — that file is committed to git.

---

### Fix 5: Knowledge/Query Returning 401 — DeviceTokenService Field Name Mismatch

**Problem**
Every call to `POST /api/v1/knowledge/query` returned HTTP 401 Unauthorized. Server logs confirmed a device-register call immediately preceding each failing query — the device was registering but the token was being rejected.

**Root Cause**
In `apps/mobile/src/services/transmission/DeviceTokenService.ts`, the `registerDevice()` method destructured the server response as:

```typescript
const { token } = await response.json();
```

But the server's `/api/v1/auth/device-register` endpoint returns:

```json
{ "device_token": "...", "expires_in_days": 30 }
```

`token` was always `undefined`. The undefined value was stored in SecureStore and sent as `Authorization: Bearer undefined` on every knowledge query, which the server correctly rejected.

**Fix — `apps/mobile/src/services/transmission/DeviceTokenService.ts`**
```typescript
// Before:
const { token } = await response.json() as { token: string };

// After:
const { device_token: token } = await response.json() as { device_token: string };
```

**Note:** `TransmissionService.ts` has its own separate `getDeviceToken()` implementation that was already correct (`{ device_token: token }`). Only `DeviceTokenService.ts` had the bug.

---

### Fix 6: Patient Not Notified When Cached Offline Report Is Transmitted

**Problem**
When the patient submitted a report while offline, the app correctly showed "Saved securely. Will send when signal is available." When WiFi was restored, `flushQueue()` silently sent the report to the server — the dashboard updated — but the patient saw no notification. The patient had no way to know their report had been received.

**Root Cause**
`flushQueue()` in `TransmissionService.ts` operated silently. There was no mechanism for any UI component to know when a cached case was successfully transmitted.

**Fix — three files changed:**

**1. `apps/mobile/src/store/transmissionStore.ts` (new file)**
Created a Zustand store that acts as a lightweight event bus between `TransmissionService` and UI screens:
```typescript
import { create } from 'zustand';
interface TransmissionState {
  lastTransmittedCaseId: string | null;
  lastTransmittedAt: number | null;
  setLastTransmitted: (caseId: string) => void;
}
export const useTransmissionStore = create<TransmissionState>((set) => ({
  lastTransmittedCaseId: null,
  lastTransmittedAt: null,
  setLastTransmitted: (caseId) =>
    set({ lastTransmittedCaseId: caseId, lastTransmittedAt: Date.now() }),
}));
```

**2. `apps/mobile/src/services/transmission/TransmissionService.ts`**
Both `_trySend()` and `flushQueue()` call `useTransmissionStore.getState().setLastTransmitted(caseId)` after a successful HTTP 202 response.

**3. `apps/mobile/src/screens/ChatScreen.tsx`**
- Subscribes to `lastTransmittedAt` from `transmissionStore`
- Uses a `useEffect` to detect when the caseId that was previously cached is now transmitted
- Two notification paths:
  - **CRITICAL path (emergency bar):** Updates `criticalTxStatus` from `'CACHED'` → `'SENT'`, which changes the bar text to "Emergency alert sent"
  - **SUFFICIENT path (chat message):** Appends an agent message: "✓ Report transmitted — your case has been relayed to the emergency network."

**4. `apps/mobile/src/screens/HomeScreen.tsx`**
- Subscribes to `lastTransmittedAt`
- Shows a 3.5-second toast banner: "✓ Report transmitted to emergency network" in green
- Calls `loadCases()` to refresh the history list
- Uses `useFocusEffect` (replaces `useEffect([], [])`) so the case list also refreshes every time the user navigates back to Home

---

### Fix 7: Switched On-Device Model from Llama 3.2 1B to Qwen2.5 1.5B

**Problem**
Llama 3.2 1B was taking 7-10 seconds per response on a 4GB RAM device. The model's instruction-following on structured prompts (SUFFICIENT/CRITICAL JSON parsing) was inconsistent.

**Decision**
Switched to **Qwen2.5 1.5B Instruct Q4_K_M** (~1 GB file, ~1.5 GB active RAM).

| Property | Llama 3.2 1B | Qwen2.5 1.5B |
|----------|--------------|--------------|
| File size | ~807 MB | ~1 GB |
| Active RAM | ~1.5 GB | ~1.5 GB |
| Context window used | 2048 tokens | 1024 tokens |
| Prompt format | Llama special tokens | ChatML (`<\|im_start\|>`) |
| Instruction following | Weaker on JSON output | Stronger on structured prompts |

**Changes — `apps/mobile/src/services/llm/SLMAdapter.ts`**

1. Updated `OLLAMA_MODEL`, `MODEL_FILENAME`, `MODEL_URL` to point to Qwen2.5 1.5B
2. Renamed `formatLlama32Prompt` → `formatChatMLPrompt` with ChatML format:
   ```
   <|im_start|>system\n{systemPrompt}<|im_end|>
   <|im_start|>user\n{content}<|im_end|>
   <|im_start|>assistant
   ```
3. Updated stop tokens: `['<|eot_id|>', '<|end_of_text|>']` → `['<|im_end|>', '<|endoftext|>']`
4. Reduced `n_ctx` from 2048 → 1024 (symptom conversations are short; saves ~20-30% inference time)
5. Added automatic cleanup of the old Llama model on first launch:
   ```typescript
   const oldInfo = await FileSystem.getInfoAsync(OLD_MODEL_PATH);
   if (oldInfo.exists) {
     await FileSystem.deleteAsync(OLD_MODEL_PATH, { idempotent: true });
   }
   ```
   This frees ~807 MB automatically — no manual action needed by the user.

**Dev mode Ollama command change:**
```bash
# Before:
ollama pull llama3.2:1b

# After:
ollama pull qwen2.5:1.5b
```

---

## Session: 2026-06-07

---

### Fix 8: Claimed Case Not Disappearing in Real Time from Other Responders' Dashboards

**Problem**
Two responders had the dashboard open in different browsers. When Responder A claimed a case, the case remained visible (though not clickable) on Responder B's dashboard until B manually refreshed the page. The underlying claim logic was correct — the second responder could not claim an already-claimed case — but the UI did not reflect the change in real time.

**Root Cause**
`emit_case_claimed` in `apps/api/app/services/socket_emitter.py` emitted the `case:claimed` Socket.IO event to `room=str(org_id)`, where `org_id` was the **claiming** organisation's ID. Each dashboard client joins only its own org's room on connect. Responders from other organisations were never in the claiming org's room and therefore never received the event. The frontend `handleClaimed` handler (which correctly removes the case from the active list) simply never fired on non-claiming dashboards.

**Fix — `apps/api/app/routers/cases.py`**
Changed the `emit_case_claimed` call in `claim_case` to pass `org_id=None`, which triggers the global broadcast path in the emitter (no `room` argument → all connected sockets receive the event).

```python
# Before:
await socket_emitter.emit_case_claimed(
    case_id=case_id,
    claimed_by_org_name=org_name,
    org_id=str(current_user.org_id),   # only claiming org's room
)

# After:
await socket_emitter.emit_case_claimed(
    case_id=case_id,
    claimed_by_org_name=org_name,
    org_id=None,   # broadcast to all connected dashboards
)
```

No frontend changes were needed — the `handleClaimed` handler was already correct.

---

### Fix 9: Past Cases List Showing Cases Claimed by Other Organisations

**Problem**
A newly registered responder opened the dashboard and saw a very long Past Cases list containing cases claimed and resolved by completely different organisations. Each responder should only see cases that their own organisation handled.

**Root Cause**
The `GET /api/v1/cases` endpoint (`apps/api/app/routers/cases.py`) applied no org scoping when returning non-PENDING cases. A query for `status=ACKNOWLEDGED,RESOLVED,CLOSED` returned every case across all organisations regardless of who claimed it.

**Fix — `apps/api/app/routers/cases.py`**
In `list_cases`, when the status filter contains no PENDING status (i.e. it is a history query) and the requester is not an ADMIN, a `claimed_by_org_id = current_user.org_id` condition is automatically added.

```python
if status:
    statuses = [CaseStatus(s.strip()) for s in status.split(",") if s.strip()]
    conditions.append(Case.status.in_(statuses))
    # History queries are org-scoped for non-admin users
    if CaseStatus.PENDING not in statuses and current_user.role != "ADMIN":
        conditions.append(Case.claimed_by_org_id == current_user.org_id)
```

**Behaviour summary:**
- `status=PENDING` → no org scope (all responders see all active cases to claim)
- `status=ACKNOWLEDGED,RESOLVED,CLOSED` + non-ADMIN → scoped to requester's org
- Any role with `ADMIN` → sees all orgs' history

Also renamed `_current_user` → `current_user` in the function signature so the dependency is accessible in the handler body.

---

### Feature: Appointment Booking — Primary-Care Marketplace (Thin Version)

**Motivation**
MediReach's disaster capability is dormant between events, creating a user-retention and sustainability problem. The thesis (section 6.2.1) proposes extending the platform into a daily-use primary-care appointment marketplace. The key differentiator: doctors receive a structured pre-appointment SOAP note before the patient arrives, generated by the existing pipeline. This session implements the **thin version** — no self-service practitioner signup, no payment, no calendar sync. Practitioners are added manually by admins; slots are simple fixed windows.

**Files added / changed:**

**Backend**

`apps/api/app/models/db.py`
- Added `Specialty` enum (GENERAL_PHYSICIAN, CARDIOLOGIST, DERMATOLOGIST, ORTHOPEDIC, PEDIATRICIAN, PULMONOLOGIST, NEUROLOGIST, OTHER)
- Added `AppointmentStatus` enum (PENDING, CONFIRMED, CANCELLED)
- Added `Practitioner` model — linked to `Organization`, holds name/specialty/city/clinic_name/phone/bio/is_active
- Added `PractitionerSlot` model — one bookable time slot (slot_date YYYY-MM-DD, slot_time HH:MM, is_booked)
- Added `Appointment` model — links a patient booking to a `Practitioner` + `PractitionerSlot`, optionally to a `Case` (null for GREEN-triage patients who have no server-side case). When `case_id` is set and a SOAP report exists, the dashboard surfaces it before the appointment.

`apps/api/alembic/versions/20260607_0006_add_appointments.py`
- Migration creating `practitioners`, `practitioner_slots`, `appointments` tables. Run `alembic upgrade head` to apply.

`apps/api/app/routers/appointments.py` (new file)
- `GET /api/v1/practitioners` — public list, optional `?specialty=` and `?city=` filters
- `GET /api/v1/practitioners/{id}/slots` — available (unbooked) slots for a practitioner
- `POST /api/v1/appointments` — create booking; marks slot as `is_booked=True` atomically; accepts device token (optional) or no auth
- `GET /api/v1/appointments` — dashboard view, org-scoped for non-ADMIN (returns appointments for practitioners belonging to the requester's org, including joined SOAP note)

`apps/api/app/routers/admin/practitioners.py` (new file)
- `GET /api/v1/admin/practitioners` — list all practitioners (admin only)
- `POST /api/v1/admin/practitioners` — create practitioner (linked to admin's org)
- `DELETE /api/v1/admin/practitioners/{id}` — delete practitioner + cascade slots
- `POST /api/v1/admin/practitioners/{id}/slots` — bulk-add availability slots `[{slot_date, slot_time}, ...]`
- `DELETE /api/v1/admin/practitioners/{id}/slots/{slot_id}` — delete a single unbooked slot

`apps/api/app/models/schemas.py`
- Added `PractitionerItem`, `PractitionerDetailResponse`, `PractitionerListResponse`
- Added `PractitionerSlotItem`, `CreatePractitionerRequest`, `AddSlotsRequest`
- Added `BookAppointmentRequest`, `AppointmentResponse`, `AppointmentDetailResponse`, `AppointmentListResponse`

`apps/api/app/main.py`
- Registered `appointments.router` at `/api/v1`
- Registered `admin_practitioners.router` at `/api/v1/admin`

**Dashboard**

`apps/dashboard/app/(dashboard)/appointments/page.tsx` (new file)
- Lists incoming appointments for the org's practitioners, grouped by status (PENDING / CONFIRMED / other)
- Each card shows patient name, phone, chief complaint, practitioner, slot date/time, triage level badge
- Expand button reveals the full SOAP note inline (subjective / objective / assessment / plan)

`apps/dashboard/app/(dashboard)/admin/practitioners/page.tsx` (new file)
- Two-panel layout: left = practitioner list with inline slot manager, right = "Add Practitioner" form
- Slot manager: pick a date, toggle time chips (08:00–18:30 in 30-min increments), bulk-add
- Delete button on each practitioner (with confirmation)

`apps/dashboard/app/(dashboard)/layout.tsx`
- Added "Appointments" (CalendarDays icon) to main nav (visible to all roles)
- Added "Practitioners" (Stethoscope icon) to admin nav (visible to ADMIN only)

`apps/dashboard/lib/api.ts`
- Added types: `PractitionerItem`, `PractitionerDetailResponse`, `PractitionerListResponse`, `AppointmentDetailResponse`, `AppointmentListResponse`
- Added functions: `getPractitioners`, `getPractitionerSlots`, `getAppointments`, `adminGetPractitioners`, `adminCreatePractitioner`, `adminDeletePractitioner`, `adminAddSlots`, `adminDeleteSlot`

**Mobile**

`apps/mobile/src/screens/AppointmentBookingScreen.tsx` (new file)
- Lists all available practitioners with name, specialty, clinic, city, available slot count
- Tapping a practitioner card fetches and expands their available slots inline
- Patient picks a slot → confirmation button → `POST /api/v1/appointments`
- On success: green confirmation card showing doctor name, clinic, date/time, and a note that the SOAP summary will be shared with the doctor. "Done" navigates to Home.
- Error state with retry button.

`apps/mobile/src/screens/TriageResultScreen.tsx`
- GREEN outcome: booking prompt card added between the first-aid card and the "Start New Assessment" button
- AMBER outcome: booking prompt card added after the RAG emergency guidance card
- RED outcome: no booking prompt (patient is in emergency dispatch mode)
- Prompt navigates to `AppointmentBooking` screen passing `caseId` (null for GREEN), `chiefComplaint`, `triageLevel`, `patientName`, `patientPhone`

`apps/mobile/App.tsx`
- Added `AppointmentBooking` to `RootStackParamList` with params `{ caseId, chiefComplaint, triageLevel, patientName, patientPhone }`
- Registered `AppointmentBookingScreen` in the navigator with back navigation enabled

**Design decisions for thin version:**
- Practitioners are added by ADMIN only (no self-service signup)
- Slots are simple fixed date+time strings (no calendar sync, no recurrence)
- No payment or commission processing
- No practitioner verification workflow (PMDC number not checked)
- Appointment status starts as PENDING; CONFIRMED/CANCELLED are available in the schema but no UI action for them yet — left for future work
- GREEN-triage patients can book without a `case_id` (no SOAP note available to doctor); AMBER patients book with `case_id` so the full SOAP note is surfaced on the dashboard

---

## Session: 2026-06-08

---

### Fix 10: Appointment Booking Button Never Appeared After Triage

**Problem**
After completing a GREEN or AMBER assessment, no "Book Appointment" option was visible on the result screen — not even after scrolling.

**Root Cause**
`ChatScreen._handlePostTriage` handled the entire post-triage flow inline (triage verdict bubble, RAG guidance bubble, transmission status). It never called `navigation.navigate('TriageResult', ...)`. The `TriageResultScreen` — where the booking card lived — was completely unreachable from the normal assessment flow. The booking card in `TriageResultScreen` was dead code.

**Fix — `apps/mobile/src/screens/ChatScreen.tsx`**
- Added `postTriageState` state: `{ level, caseId, chiefComplaint } | null`
- Set it at the end of `_handlePostTriage` (just before `setHasCompletedTriage(true)`) so the post-triage bar has all the data it needs
- Added a "Book Appointment →" button to the post-triage sticky bar, rendered when `postTriageState.level` is `GREEN` or `AMBER` and the screen is not in readonly (history) mode
- Button navigates to `AppointmentBooking` with the correct params:
  - GREEN → `caseId: null` (no server-side case)
  - AMBER → `caseId: <transmission case ID>` so the SOAP note is available to the doctor
- Added `bookAppointmentBtn` / `bookAppointmentBtnText` styles (dark blue card, blue text)

**Why TriageResultScreen was not used:**
`TriageResultScreen` does its own full transmission pipeline (encode → encrypt → send). Using it from `ChatScreen` would double-transmit. The correct fix was to wire the booking entry point into `ChatScreen`'s existing post-triage bar rather than navigating away.

---

### Fix 11: Appointments Nav Item Shown to All Org Types

**Problem**
The "Appointments" sidebar item appeared for NGO, GOVT, and RELIEF_CAMP responders. These organisations only operate during disasters — they have no practitioners and the appointments feature is irrelevant to them.

**Fix — 4 files**

`apps/dashboard/auth.ts`
- Added `org_type` to the object returned by `authorize()`
- Added `org_type` to the JWT token in the `jwt()` callback
- Added `session.user.org_type = token.org_type` in the `session()` callback

`apps/dashboard/types/next-auth.d.ts`
- Added `org_type: string` to the `Session.user` type declaration

`apps/dashboard/app/(dashboard)/layout.tsx`
- Renamed `navItems` → `baseNavItems`, added `hospitalOnly: true` to the Appointments entry
- All admin items have `hospitalOnly: false` (Practitioners is visible to all admins — any admin may need to set up practitioners regardless of their org type)
- Added `isHospital = session?.user?.org_type === "HOSPITAL"` derived value
- `navItems` and `adminItems` are computed by filtering `baseNavItems` / `baseAdminItems` with `!i.hospitalOnly || isHospital`

**Note:** Users logged in before this change have sessions without `org_type`. They must sign out and back in once for the filtering to apply.

---

### Fix 12: Three Cascading SQLAlchemy / PostgreSQL Enum Type Bugs

**Root Cause (shared)**
The Alembic migration (`20260607_0006_add_appointments.py`) created the `specialty`, `status` (appointments), columns as plain `VARCHAR` / `String`. However the SQLAlchemy models declared these columns with `Column(Enum(SomePythonEnum))`. When asyncpg prepares an INSERT statement it casts the value to a PostgreSQL native enum type (e.g. `$4::specialty`, `$9::appointmentstatus`). Because no such PostgreSQL type was ever created, the INSERT fails with `UndefinedObjectError: type "X" does not exist`. The data is rolled back and a 500 is returned.

**Bug A — `type "specialty" does not exist`**
Triggered on `POST /api/v1/admin/practitioners`.

Fix — `apps/api/app/models/db.py`:
```python
# Before:
specialty = Column(Enum(Specialty), nullable=False)
# After:
specialty = Column(String, nullable=False)
```

Fix — `apps/api/app/routers/admin/practitioners.py` and `apps/api/app/routers/appointments.py`:
All occurrences of `p.specialty.value` replaced with `p.specialty` (plain string, `.value` no longer exists).
Also `a.practitioner.specialty.value` → `a.practitioner.specialty` in appointments router.

**Bug B — `type "appointmentstatus" does not exist`**
Triggered on `POST /api/v1/appointments`.

Fix — `apps/api/app/models/db.py`:
```python
# Before:
status = Column(Enum(AppointmentStatus), nullable=False, default=AppointmentStatus.PENDING)
# After:
status = Column(String, nullable=False, default="PENDING")
```

**Rule going forward:** Any new model column that needs to store an enum value must use `Column(String)` unless the Alembic migration explicitly calls `op.create_type(...)` to create a native PostgreSQL enum. The Python-side `enum.Enum` class is still used for validation in the router (`Specialty(body.specialty)` raises 422 on invalid input) but must not be passed to `Column()`.

---

### Fix 13: Practitioner List Not Updating After Add (Silent Catch)

**Problem**
After successfully adding a practitioner via the admin form, the list did not update. A manual page refresh was required to see the new entry.

**Root Cause**
The `handleCreate` function has an empty `catch {}` block. While Bug A (Fix 12) was still present, `POST /api/v1/admin/practitioners` returned 500. The `request()` helper threw on non-2xx responses, `catch {}` swallowed it silently, and `load()` — which is called only on success — never ran. After Fix 12 the POST returns 201, `adminCreatePractitioner` resolves, `load()` is called, and the list refreshes automatically.

**No code change required** — the `load()` call was always there; it just never reached because of the upstream 500.

---

### Feature: "Other" Specialty Shows Custom Text Input

**Problem**
Selecting "Other" from the specialty dropdown in the Add Practitioner form provided no way to enter a custom specialty name. The word "OTHER" would be stored in the database.

**Fix — `apps/dashboard/app/(dashboard)/admin/practitioners/page.tsx`**
- Added `customSpecialty` state (string, default `""`)
- Specialty `<select>` `onChange` now also calls `setCustomSpecialty("")` to clear stale text when switching away from Other
- When `specialty === "OTHER"`, a text `<input>` appears below the dropdown (marked `required`) for the custom name
- In `handleCreate`, `resolvedSpecialty = specialty === "OTHER" ? customSpecialty.trim() || "OTHER" : specialty` — the custom text is sent to the API instead of the literal string `"OTHER"`
- On successful submission, `customSpecialty` is cleared alongside the other fields

---

### Fix 14: AppointmentBookingScreen Showing All Doctors Regardless of Symptoms

**Problem**
After AMBER triage for "right leg pain after fall", the booking screen showed doctors from all specialties instead of filtering to Orthopedic.

**Root Cause**
`AppointmentBookingScreen` fetched `/api/v1/practitioners` with no filters. There was no logic to map the patient's complaint to a relevant specialty.

**Fix — `apps/mobile/src/screens/AppointmentBookingScreen.tsx`**

Added `inferSpecialty(complaint: string): string | null` before the component:
- Checks cardiac keywords first (`chest pain`, `heart attack`, `cardiac`) to avoid them being caught by the broader orthopedic pattern
- Orthopedic: `bone|fracture|joint|leg|arm|knee|ankle|foot|wrist|elbow|shoulder|fall|fell|fallen|slip|twisted|strain|swollen|injury|cricket|sport|...`
- Dermatology, Pediatrics, Pulmonology, Neurology, General Physician follow in order
- Returns `null` if no keyword matches (falls back to all doctors)

Fetch logic changed from a single call to a two-stage fetch:
1. If a specialty is inferred, fetch `GET /api/v1/practitioners?specialty=ORTHOPEDIC`
2. If that returns at least one result → use it, set `isFiltered = true`
3. If that returns empty (no doctor of that specialty added yet) → fall back to `GET /api/v1/practitioners` (all), set `isFiltered = false`

Subheading is now contextual:
- Filtered: `"Showing Orthopedics recommended for your condition. Your clinical summary will be sent to them in advance."`
- Fallback: `"Select a doctor and a time that works for you. Your clinical summary will be sent to them in advance."`

**Why the original regex missed "right leg pain after fall":**
The initial keyword list only included `bone`, `fracture`, `joint`, `cricket`, `sports`, `sprain`, `ligament`, `back pain`, `muscle pain`, `aching`, `injury`, `broken`. None of these appear in `"right leg pain after fall"`. The expanded list adds `leg`, `arm`, `knee`, `ankle`, `fall`, `fell`, `fallen`, `slip`, `twisted`, `strain`, `swollen`, and compound forms like `leg pain`, `arm pain`.
