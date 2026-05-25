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
