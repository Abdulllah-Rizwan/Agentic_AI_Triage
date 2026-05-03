import { networkStore } from '../../store/networkStore';
import { userStore } from '../../store/userStore';
import {
  getPendingPayloads,
  deletePendingPayload,
  incrementPayloadAttempts,
  savePendingPayload,
  saveCompletedCase,
} from '../../db/queries';
import { deriveKey, decrypt, decodePayload, encrypt, encodePayload } from '../encryption/AESEncryption';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const RETRY_INTERVAL_MS = 60_000;
const MAX_ATTEMPTS = 5;

let retryInterval: ReturnType<typeof setInterval> | null = null;

export async function cachePayload(
  caseId: string,
  payloadBytes: Uint8Array,
  triageLevel: string,
): Promise<void> {
  const { profile, deviceId } = userStore.getState();
  if (!profile) throw new Error('No user profile');

  const key = await deriveKey(profile.cnic, deviceId);
  const base64 = Buffer.from(payloadBytes).toString('base64');
  const encrypted = await encrypt(base64, key);
  const blob = encodePayload(encrypted);

  await savePendingPayload({
    case_id: caseId,
    encrypted_blob: blob,
    triage_level: triageLevel,
    created_at: Date.now(),
  });
}

export async function flushQueue(): Promise<void> {
  const mode = networkStore.getState().mode;
  if (mode === 'OFFLINE') return;

  const { profile, deviceId } = userStore.getState();
  if (!profile) return;

  const pending = await getPendingPayloads(MAX_ATTEMPTS);

  for (const record of pending) {
    try {
      const key = await deriveKey(profile.cnic, deviceId);
      const parsed = decodePayload(record.encrypted_blob);
      const decrypted = await decrypt(parsed.cipher, key, parsed.iv);
      const payloadBytes = Buffer.from(decrypted, 'base64');

      const response = await fetch(`${API_BASE_URL}/api/v1/cases/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payloadBytes,
      });

      if (response.ok || response.status === 202) {
        await deletePendingPayload(record.case_id);
        await saveCompletedCase({
          case_id: record.case_id,
          triage_level: record.triage_level,
          chief_complaint: 'Transmitted',
          completed_at: Date.now(),
        });
      } else {
        await incrementPayloadAttempts(record.case_id);
      }
    } catch {
      await incrementPayloadAttempts(record.case_id);
    }
  }
}

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
