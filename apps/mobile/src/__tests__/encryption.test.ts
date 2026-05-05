// Mock react-native-aes-crypto with Node.js crypto so tests run outside RN.
// The mock mirrors the real API: pbkdf2/randomKey/encrypt/decrypt.

const nodeCrypto = require('crypto') as typeof import('crypto');

jest.mock('react-native-aes-crypto', () => {
  const c = require('crypto');
  return {
    default: {
      pbkdf2: (
        password: string,
        salt: string,
        iterations: number,
        keyBits: number,
        digest: string,
      ) =>
        Promise.resolve(
          c.pbkdf2Sync(password, salt, iterations, keyBits / 8, digest).toString('hex'),
        ),
      randomKey: (byteCount: number) =>
        Promise.resolve(c.randomBytes(byteCount).toString('hex')),
      encrypt: (data: string, key: string, iv: string) => {
        const cipher = c.createCipheriv(
          'aes-256-cbc',
          Buffer.from(key, 'hex'),
          Buffer.from(iv, 'hex'),
        );
        return Promise.resolve(
          Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('base64'),
        );
      },
      decrypt: (data: string, key: string, iv: string) => {
        const decipher = c.createDecipheriv(
          'aes-256-cbc',
          Buffer.from(key, 'hex'),
          Buffer.from(iv, 'hex'),
        );
        return Promise.resolve(
          Buffer.concat([decipher.update(data, 'base64'), decipher.final()]).toString('utf8'),
        );
      },
    },
  };
});

import {
  deriveKey,
  encryptPayload,
  decryptPayload,
  encryptLeanPayload,
  decryptLeanPayload,
} from '../services/encryption/AESEncryption';

describe('deriveKey', () => {
  test('produces consistent output for the same inputs', async () => {
    const key1 = await deriveKey('12345-678901-2', 'device-abc');
    const key2 = await deriveKey('12345-678901-2', 'device-abc');
    expect(key1).toBe(key2);
  });

  test('returns a 64-character hex string (256-bit key)', async () => {
    const key = await deriveKey('42101-1234567-1', 'device-xyz');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('encryptPayload / decryptPayload roundtrip', () => {
  test('decrypt(encrypt(data)) === data', async () => {
    const key = await deriveKey('99999-000000-1', 'test-device');
    const original = 'Hello, disaster zone!';
    const encrypted = await encryptPayload(original, key);
    const decrypted = await decryptPayload(encrypted, key);
    expect(decrypted).toBe(original);
  });

  test('each encryption call produces a different ciphertext (random IV)', async () => {
    const key = await deriveKey('11111-222222-3', 'test-device');
    const plaintext = 'same data';
    const enc1 = await encryptPayload(plaintext, key);
    const enc2 = await encryptPayload(plaintext, key);
    expect(enc1).not.toBe(enc2);
  });
});

describe('encryptLeanPayload / decryptLeanPayload roundtrip', () => {
  test('decrypt(encrypt(bytes)) returns identical Uint8Array', async () => {
    const cnic = '35202-1234567-1';
    const deviceId = 'device-001';
    const original = new Uint8Array([0x01, 0x02, 0xff, 0x00, 0xab, 0xcd]);
    const blob = await encryptLeanPayload(original, cnic, deviceId);
    const restored = await decryptLeanPayload(blob, cnic, deviceId);
    expect(restored).toEqual(original);
  });
});
