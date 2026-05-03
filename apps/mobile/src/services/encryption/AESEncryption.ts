export interface AESResult {
  cipher: string;
  iv: string;
}

// react-native-aes-crypto is a native module — not available in Expo Go.
// All functions degrade gracefully: encryption is skipped, plaintext is stored.
// This is acceptable for development/UI testing only.

async function getAes() {
  try {
    // Dynamic import so Metro doesn't crash when the native module is absent
    const mod = await import('react-native-aes-crypto');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod as any).default ?? mod;
  } catch {
    return null;
  }
}

export async function deriveKey(cnic: string, deviceId: string): Promise<string> {
  const Aes = await getAes();
  if (!Aes) return `${cnic}:${deviceId}:devkey`;
  return Aes.pbkdf2(`${cnic}:${deviceId}`, 'medireach_payload_salt', 100000, 256, 'sha256');
}

export async function encrypt(plaintext: string, key: string): Promise<AESResult> {
  const Aes = await getAes();
  if (!Aes) return { cipher: plaintext, iv: 'deviv' };
  const iv = await Aes.randomKey(16);
  const cipher = await Aes.encrypt(plaintext, key, iv, 'aes-256-cbc');
  return { cipher, iv };
}

export async function decrypt(cipher: string, key: string, iv: string): Promise<string> {
  const Aes = await getAes();
  if (!Aes || iv === 'deviv') return cipher;
  return Aes.decrypt(cipher, key, iv, 'aes-256-cbc');
}

export function encodePayload(result: AESResult): string {
  return JSON.stringify(result);
}

export function decodePayload(blob: string): AESResult {
  return JSON.parse(blob) as AESResult;
}
