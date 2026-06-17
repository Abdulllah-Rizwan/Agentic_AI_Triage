import { getDb } from './database';
import Aes from 'react-native-aes-crypto';

export interface UserProfile {
  id: string;
  full_name: string;
  phone: string;
  cnic: string;
  lat: number | null;
  lng: number | null;
  registered_at: number;
  password_hash: string | null;
}

// ── Password hashing ──────────────────────────────────────────────────────────

const PW_SALT = 'medireach_pw_salt_v1';

export function hashPassword(password: string): Promise<string> {
  return Aes.pbkdf2(password, PW_SALT, 50_000, 32, 'sha256');
}

export interface PendingPayload {
  case_id: string;
  encrypted_blob: string;
  triage_level: string;
  created_at: number;
  attempts: number;
  last_attempt: number | null;
}

export interface CompletedCase {
  case_id: string;
  triage_level: string;
  chief_complaint: string;
  completed_at: number;
  acknowledged: number;
}

// ── User Profile ──────────────────────────────────────────────────────────────

export async function saveUserProfile(profile: Omit<UserProfile, 'id'>): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO user_profile
      (id, full_name, phone, cnic, lat, lng, registered_at, password_hash)
     VALUES ('local_user', ?, ?, ?, ?, ?, ?, ?)`,
    [
      profile.full_name,
      profile.phone,
      profile.cnic,
      profile.lat ?? null,
      profile.lng ?? null,
      profile.registered_at,
      profile.password_hash ?? null,
    ],
  );
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const db = getDb();
  const row = await db.getFirstAsync<UserProfile>(
    `SELECT * FROM user_profile WHERE id = 'local_user'`,
  );
  return row ?? null;
}

// ── Pending Payloads ──────────────────────────────────────────────────────────

export async function savePendingPayload(payload: Omit<PendingPayload, 'attempts' | 'last_attempt'>): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO pending_payloads
      (case_id, encrypted_blob, triage_level, created_at, attempts, last_attempt)
     VALUES (?, ?, ?, ?, 0, NULL)`,
    [payload.case_id, payload.encrypted_blob, payload.triage_level, payload.created_at],
  );
}

export async function getPendingPayloads(maxAttempts: number): Promise<PendingPayload[]> {
  const db = getDb();
  const rows = await db.getAllAsync<PendingPayload>(
    `SELECT * FROM pending_payloads WHERE attempts < ? ORDER BY created_at ASC`,
    [maxAttempts],
  );
  return rows;
}

export async function deletePendingPayload(caseId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM pending_payloads WHERE case_id = ?`, [caseId]);
}

export async function incrementPayloadAttempts(caseId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE pending_payloads SET attempts = attempts + 1, last_attempt = ? WHERE case_id = ?`,
    [Date.now(), caseId],
  );
}

// ── Completed Cases ───────────────────────────────────────────────────────────

export async function saveCompletedCase(c: Omit<CompletedCase, 'acknowledged'>): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO completed_cases
      (case_id, triage_level, chief_complaint, completed_at, acknowledged)
     VALUES (?, ?, ?, ?, 0)`,
    [c.case_id, c.triage_level, c.chief_complaint, c.completed_at],
  );
}

export async function getCompletedCases(): Promise<CompletedCase[]> {
  const db = getDb();
  const rows = await db.getAllAsync<CompletedCase>(
    `SELECT * FROM completed_cases ORDER BY completed_at DESC`,
  );
  return rows;
}

export async function markCaseAcknowledged(caseId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE completed_cases SET acknowledged = 1 WHERE case_id = ?`,
    [caseId],
  );
}

// ── App Metadata ──────────────────────────────────────────────────────────────

export async function getMetadata(key: string): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = ?`,
    [key],
  );
  return row?.value ?? null;
}

export async function setMetadata(key: string, value: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    [key, value],
  );
}

// ── Active Chat Session ───────────────────────────────────────────────────────

const ACTIVE_CHAT_KEY = 'active_chat_session';

export async function saveActiveSession(session: unknown): Promise<void> {
  await setMetadata(ACTIVE_CHAT_KEY, JSON.stringify(session));
}

export async function loadActiveSession<T = unknown>(): Promise<T | null> {
  const raw = await getMetadata(ACTIVE_CHAT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function clearActiveSession(): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM app_metadata WHERE key = ?`, [ACTIVE_CHAT_KEY]);
}

// ── Chat History (per-case conversation replay) ───────────────────────────────

const CHAT_HISTORY_PREFIX = 'chat_history_';

export async function saveChatHistory(caseId: string, messages: unknown[]): Promise<void> {
  await setMetadata(`${CHAT_HISTORY_PREFIX}${caseId}`, JSON.stringify(messages));
}

export async function loadChatHistory(caseId: string): Promise<unknown[] | null> {
  const raw = await getMetadata(`${CHAT_HISTORY_PREFIX}${caseId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown[];
  } catch {
    return null;
  }
}

// ── Session Helpers ───────────────────────────────────────────────────────────

export async function deleteUserProfile(): Promise<void> {
  const db = getDb();
  await db.runAsync(`DELETE FROM user_profile WHERE id = 'local_user'`);
}

export async function getLastActivityAt(): Promise<number | null> {
  const raw = await getMetadata('session_last_activity');
  if (!raw) return null;
  const ts = parseInt(raw, 10);
  return isNaN(ts) ? null : ts;
}

export async function setLastActivityAt(timestamp: number): Promise<void> {
  await setMetadata('session_last_activity', String(timestamp));
}
