import * as Device from 'expo-device';

import { networkStore } from '../../store/networkStore';
import { useTransmissionStore } from '../../store/transmissionStore';
import { userStore } from '../../store/userStore';
import {
  getPendingPayloads,
  deletePendingPayload,
  incrementPayloadAttempts,
  savePendingPayload,
  saveCompletedCase,
  getMetadata,
  setMetadata,
} from '../../db/queries';
import {
  deriveKey,
  encryptPayload,
  decryptPayload,
} from '../encryption/AESEncryption';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const RETRY_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 5;
const DEVICE_TOKEN_KEY = 'medireach_device_token';

let retryInterval: ReturnType<typeof setInterval> | null = null;

// ── Device token ──────────────────────────────────────────────────────────────

/**
 * Returns a cached device JWT, or registers with the server if none is stored.
 * Persists the token in expo-secure-store when available, falls back to the
 * SQLite app_metadata table.
 */
export async function getDeviceToken(): Promise<string> {
  // Try expo-secure-store first (preferred — hardware-backed on Android/iOS)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const SecureStore = require('expo-secure-store') as any;
    const cached: string | null = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
    if (cached) return cached;
  } catch {
    // expo-secure-store not installed or unavailable — fall through to SQLite
  }

  // SQLite fallback
  const sqliteCached = await getMetadata(DEVICE_TOKEN_KEY);
  if (sqliteCached) return sqliteCached;

  // No cached token — register with the server
  const deviceId = Device.osInternalBuildId ?? 'unknown-device';
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/device-register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, device_model: 'Unknown', app_version: '1.0.0' }),
  });

  if (!response.ok) {
    throw new Error(`Device registration failed: ${response.status}`);
  }

  const data = (await response.json()) as { device_token: string };
  const token = data.device_token;

  // Persist for next session
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const SecureStore = require('expo-secure-store') as any;
    await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
  } catch {
    await setMetadata(DEVICE_TOKEN_KEY, token);
  }

  return token;
}

// ── Internal send helper ──────────────────────────────────────────────────────

/**
 * Decrypts `encryptedBlob` and POSTs the raw protobuf bytes to the ingest
 * endpoint.  The caller is responsible for ensuring the blob is already
 * persisted in SQLite before calling this (sendOrCache does this).
 * Returns true on HTTP 2xx/202, false on any error.
 *
 * Accepts the blob directly so we never depend on a DB read-back — the
 * previous pattern of save-then-read caused silent failures when the SQLite
 * query returned before the write was visible.
 */
async function _trySend(
  caseId: string,
  encryptedBlob: string,
  triageLevel: 'RED' | 'AMBER' | 'GREEN',
): Promise<boolean> {
  const { profile, deviceId } = userStore.getState();
  if (!profile) {
    console.warn('[Transmission] _trySend: no user profile — aborting');
    return false;
  }

  const mode = networkStore.getState().mode;
  console.log(`[Transmission] _trySend start — mode=${mode} caseId=${caseId.slice(0, 8)}`);

  try {
    const key = await deriveKey(profile.cnic, deviceId);
    const base64 = await decryptPayload(encryptedBlob, key);
    const payloadBytes = Buffer.from(base64, 'base64');

    let token = '';
    try {
      token = await getDeviceToken();
    } catch {
      // Proceed without auth token — server accepts unauthenticated ingests
    }

    const ingestUrl = `${API_BASE_URL}/api/v1/cases/ingest`;
    console.log(`[Transmission] POST ${ingestUrl} (${payloadBytes.length} bytes, token=${!!token})`);

    const response = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payloadBytes,
    });

    if (response.ok || response.status === 202) {
      console.log(`[Transmission] Case ${caseId} accepted by server (HTTP ${response.status})`);
      await deletePendingPayload(caseId);
      await saveCompletedCase({
        case_id: caseId,
        triage_level: triageLevel,
        chief_complaint: 'Transmitted',
        completed_at: Date.now(),
      });
      useTransmissionStore.getState().setLastTransmitted(caseId);
      return true;
    }

    const body = await response.text().catch(() => '');
    console.warn(`[Transmission] Ingest rejected: HTTP ${response.status} — ${body} — case ${caseId}`);
    return false;
  } catch (err) {
    console.error(`[Transmission] _trySend network error for case ${caseId}: ${String(err)}`);
    console.error(`[Transmission] Target URL was: ${API_BASE_URL}/api/v1/cases/ingest`);
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * High-level entry point called by TriageResultScreen.
 *
 * The caller passes an ALREADY-encrypted blob (from AESEncryption.encryptPayload).
 * This function:
 *   1. Persists the encrypted blob in SQLite for durability.
 *   2. If offline → returns 'CACHED'.
 *   3. If online → attempts immediate send; returns 'SENT' or falls back to 'CACHED'.
 */
export async function sendOrCache(
  caseId: string,
  encryptedBlob: string,
  triageLevel: 'RED' | 'AMBER' | 'GREEN',
): Promise<'SENT' | 'CACHED'> {
  // Always persist first — guarantees no data loss on crash/kill
  await savePendingPayload({
    case_id: caseId,
    encrypted_blob: encryptedBlob,
    triage_level: triageLevel,
    created_at: Date.now(),
  });

  const mode = networkStore.getState().mode;
  console.log(`[Transmission] sendOrCache — mode=${mode} caseId=${caseId.slice(0, 8)}`);
  if (mode === 'OFFLINE') return 'CACHED';

  // Pass blob directly — avoids a DB read-back that can silently return empty.
  const sent = await _trySend(caseId, encryptedBlob, triageLevel);
  return sent ? 'SENT' : 'CACHED';
}

/**
 * Convenience wrapper used by screens that have raw protobuf bytes rather than
 * a pre-encrypted blob. Encrypts internally, then calls sendOrCache.
 */
export async function cachePayload(
  caseId: string,
  payloadBytes: Uint8Array,
  triageLevel: string,
): Promise<void> {
  const { profile, deviceId } = userStore.getState();
  if (!profile) throw new Error('No user profile');

  const key = await deriveKey(profile.cnic, deviceId);
  const base64 = Buffer.from(payloadBytes).toString('base64');
  const encryptedBlob = await encryptPayload(base64, key);

  await savePendingPayload({
    case_id: caseId,
    encrypted_blob: encryptedBlob,
    triage_level: triageLevel,
    created_at: Date.now(),
  });
}

/**
 * Flushes all pending payloads to the server.
 * Called by the retry loop and by TriageResultScreen after cachePayload.
 */
export async function flushQueue(): Promise<void> {
  const mode = networkStore.getState().mode;
  if (mode === 'OFFLINE') return;

  const { profile, deviceId } = userStore.getState();
  if (!profile) return;

  const pending = await getPendingPayloads(MAX_ATTEMPTS);
  if (pending.length === 0) return;

  console.log(`[Transmission] flushQueue — ${pending.length} pending, mode=${mode}`);

  for (const record of pending) {
    try {
      const key = await deriveKey(profile.cnic, deviceId);
      const base64 = await decryptPayload(record.encrypted_blob, key);
      const payloadBytes = Buffer.from(base64, 'base64');

      let token = '';
      try {
        token = await getDeviceToken();
      } catch {
        // Continue without token
      }

      const ingestUrl = `${API_BASE_URL}/api/v1/cases/ingest`;
      console.log(`[Transmission] flushQueue POST ${ingestUrl} case=${record.case_id.slice(0, 8)} (${payloadBytes.length} bytes)`);

      const response = await fetch(ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: payloadBytes,
      });

      if (response.ok || response.status === 202) {
        console.log(`[Transmission] flushQueue: case ${record.case_id.slice(0, 8)} accepted (HTTP ${response.status})`);
        await deletePendingPayload(record.case_id);
        await saveCompletedCase({
          case_id: record.case_id,
          triage_level: record.triage_level,
          chief_complaint: 'Transmitted',
          completed_at: Date.now(),
        });
        useTransmissionStore.getState().setLastTransmitted(record.case_id);
      } else {
        const body = await response.text().catch(() => '');
        console.warn(`[Transmission] flushQueue: HTTP ${response.status} for case ${record.case_id.slice(0, 8)} — ${body}`);
        await incrementPayloadAttempts(record.case_id);
      }
    } catch (err) {
      console.error(`[Transmission] flushQueue failed for case ${record.case_id.slice(0, 8)}: ${String(err)}`);
      await incrementPayloadAttempts(record.case_id);
    }
  }
}

/**
 * Starts the background retry loop. Uses setInterval (60s) to periodically
 * flush the pending queue when connectivity is available.
 *
 * Note: expo-task-manager background tasks require native config in app.json
 * and top-level TaskManager.defineTask() calls. For reliability in this
 * implementation we use setInterval which runs while the app is in the
 * foreground. Background delivery is handled by the next foreground session.
 */
export function startRetryLoop(): void {
  if (retryInterval) return;
  retryInterval = setInterval(flushQueue, RETRY_INTERVAL_MS);
}

export function stopRetryLoop(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}

/**
 * Returns how many payloads are waiting to be sent and how old the oldest is.
 * Used by TriageResultScreen to display "X reports queued".
 */
export async function getQueueStatus(): Promise<{
  pending: number;
  oldestAge: number | null;
}> {
  const records = await getPendingPayloads(MAX_ATTEMPTS);
  if (records.length === 0) return { pending: 0, oldestAge: null };
  const oldest = records.reduce((min, r) => Math.min(min, r.created_at), Infinity);
  return { pending: records.length, oldestAge: Date.now() - oldest };
}

// ── Singleton facade ──────────────────────────────────────────────────────────

/**
 * Object facade used by TriageResultScreen and other callers that prefer
 * instance-style access over named imports.
 *
 * The `payload` param in `sendOrCache` is accepted for API symmetry with the
 * spec but is not used — the encrypted blob already contains all payload data.
 */
export const transmissionService = {
  sendOrCache: (
    caseId: string,
    _payload: unknown,
    encryptedBlob: string,
    triageLevel: 'RED' | 'AMBER' | 'GREEN',
  ) => sendOrCache(caseId, encryptedBlob, triageLevel),
  cachePayload,
  flushQueue,
  startRetryLoop,
  stopRetryLoop,
  getQueueStatus,
};
