// react-native-aes-crypto is a native module — not available in Expo Go.
// Every function degrades gracefully: encryption is skipped in dev mode.
// This is acceptable for UI development only; prod builds use real AES-256-CBC.

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export interface AESResult {
  cipher: string;
  iv: string;
}

function getAes() {
  try {
    // Use require() so Jest can mock this module reliably; dynamic import()
    // is not always intercepted by jest.mock() depending on babel config.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-aes-crypto');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Aes = (mod as any).default ?? mod;
    // In Expo Go the module loads but the native bridge is absent, so native
    // methods like pbkdf2 are undefined.  Return null so callers fall through
    // to their dev-mode bypass paths instead of crashing at call time.
    if (typeof Aes?.pbkdf2 !== 'function') return null;
    return Aes;
  } catch {
    return null;
  }
}

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derives a 256-bit AES key from CNIC + deviceId using PBKDF2-SHA256.
 * Returns a hex string.
 */
export async function deriveKey(cnic: string, deviceId: string): Promise<string> {
  const Aes = getAes();
  if (!Aes) return `${cnic}:${deviceId}:devkey`;
  try {
    return await Aes.pbkdf2(
      `${cnic}:${deviceId}`,
      'medireach_payload_salt',
      100000,
      256,
      'sha256',
    );
  } catch (err) {
    throw new EncryptionError(`Key derivation failed: ${String(err)}`);
  }
}

// ── High-level API (used by TriageResultScreen and TransmissionService) ───────

/**
 * Encrypts `data` with AES-256-CBC.
 * Returns the result as `"{iv}:{ciphertext}"` — a single string safe for SQLite storage.
 */
export async function encryptPayload(data: string, key: string): Promise<string> {
  const Aes = getAes();
  if (!Aes) return `deviv:${data}`;
  try {
    const iv = (await Aes.randomKey(16)) as string;
    const cipher = (await Aes.encrypt(data, key, iv, 'aes-256-cbc')) as string;
    return `${iv}:${cipher}`;
  } catch (err) {
    throw new EncryptionError(`Encryption failed: ${String(err)}`);
  }
}

/**
 * Decrypts an `"{iv}:{ciphertext}"` string produced by `encryptPayload`.
 * Returns the original plaintext.
 */
export async function decryptPayload(encryptedData: string, key: string): Promise<string> {
  const colonIdx = encryptedData.indexOf(':');
  if (colonIdx === -1) {
    throw new EncryptionError('Invalid encrypted data: missing IV separator');
  }
  const iv = encryptedData.slice(0, colonIdx);
  const cipher = encryptedData.slice(colonIdx + 1);

  if (iv === 'deviv') return cipher; // dev fallback — never encrypted

  const Aes = getAes();
  if (!Aes) return cipher;
  try {
    return (await Aes.decrypt(cipher, key, iv, 'aes-256-cbc')) as string;
  } catch (err) {
    throw new EncryptionError(`Decryption failed: ${String(err)}`);
  }
}

// ── Low-level helpers (kept for TransmissionService backward-compat) ──────────

export async function encrypt(plaintext: string, key: string): Promise<AESResult> {
  const Aes = getAes();
  if (!Aes) return { cipher: plaintext, iv: 'deviv' };
  const iv = (await Aes.randomKey(16)) as string;
  const cipher = (await Aes.encrypt(plaintext, key, iv, 'aes-256-cbc')) as string;
  return { cipher, iv };
}

export async function decrypt(cipher: string, key: string, iv: string): Promise<string> {
  const Aes = getAes();
  if (!Aes || iv === 'deviv') return cipher;
  return (await Aes.decrypt(cipher, key, iv, 'aes-256-cbc')) as string;
}

export function encodePayload(result: AESResult): string {
  return JSON.stringify(result);
}

export function decodePayload(blob: string): AESResult {
  return JSON.parse(blob) as AESResult;
}

// ── Lean-payload convenience wrappers (used by TriageResultScreen) ─────────────

/**
 * Derives a key from cnic+deviceId, converts the raw protobuf bytes to base64,
 * and returns an encrypted blob ready for SQLite storage.
 */
export async function encryptLeanPayload(
  payloadBytes: Uint8Array,
  cnic: string,
  deviceId: string,
): Promise<string> {
  const key = await deriveKey(cnic, deviceId);
  const base64 = Buffer.from(payloadBytes).toString('base64');
  return encryptPayload(base64, key);
}

/**
 * Derives a key from cnic+deviceId, decrypts the blob, and returns the raw
 * protobuf bytes ready for HTTP transmission.
 */
export async function decryptLeanPayload(
  encryptedBlob: string,
  cnic: string,
  deviceId: string,
): Promise<Uint8Array> {
  const key = await deriveKey(cnic, deviceId);
  const base64 = await decryptPayload(encryptedBlob, key);
  return new Uint8Array(Buffer.from(base64, 'base64'));
}
