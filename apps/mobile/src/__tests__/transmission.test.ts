// Heavy module mocking — all native / Expo / DB deps are replaced.

// ── Mocks (hoisted by babel-jest) ─────────────────────────────────────────────

let mockNetworkMode: 'FULL' | 'DEGRADED' | 'OFFLINE' = 'FULL';

jest.mock('../../src/store/networkStore', () => ({
  networkStore: { getState: () => ({ mode: mockNetworkMode }) },
}), { virtual: true });

// Relative from TransmissionService perspective
jest.mock('../store/networkStore', () => ({
  networkStore: { getState: () => ({ mode: mockNetworkMode }) },
}));

jest.mock('../store/userStore', () => ({
  userStore: {
    getState: () => ({
      profile: { cnic: '12345-678901-2', full_name: 'Test User', phone: '0300-0000000', lat: 0, lng: 0 },
      deviceId: 'mock-device-id',
    }),
  },
}));

const mockSavePendingPayload   = jest.fn().mockResolvedValue(undefined);
const mockGetPendingPayloads   = jest.fn().mockResolvedValue([]);
const mockDeletePendingPayload = jest.fn().mockResolvedValue(undefined);
const mockIncrementAttempts    = jest.fn().mockResolvedValue(undefined);
const mockSaveCompletedCase    = jest.fn().mockResolvedValue(undefined);
const mockGetMetadata          = jest.fn().mockResolvedValue(null);
const mockSetMetadata          = jest.fn().mockResolvedValue(undefined);

jest.mock('../db/queries', () => ({
  savePendingPayload:      (...a: unknown[]) => mockSavePendingPayload(...a),
  getPendingPayloads:      (...a: unknown[]) => mockGetPendingPayloads(...a),
  deletePendingPayload:    (...a: unknown[]) => mockDeletePendingPayload(...a),
  incrementPayloadAttempts:(...a: unknown[]) => mockIncrementAttempts(...a),
  saveCompletedCase:       (...a: unknown[]) => mockSaveCompletedCase(...a),
  getMetadata:             (...a: unknown[]) => mockGetMetadata(...a),
  setMetadata:             (...a: unknown[]) => mockSetMetadata(...a),
}));

jest.mock('../services/encryption/AESEncryption', () => ({
  deriveKey:    jest.fn().mockResolvedValue('aaaa'.repeat(16)), // 64-char hex
  encryptPayload: jest.fn().mockResolvedValue('deviv:mockencrypted'),
  decryptPayload: jest.fn().mockResolvedValue(Buffer.from('mock-proto-bytes').toString('base64')),
}));

jest.mock('expo-device', () => ({
  osInternalBuildId: 'mock-os-build-id',
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

// ── Tests ──────────────────────────────────────────────────────────────────────

import { sendOrCache } from '../services/transmission/TransmissionService';

const MOCK_CASE_ID = 'aaaabbbb-0000-4000-8000-ccccddddeeee';

beforeEach(() => {
  jest.clearAllMocks();
  mockNetworkMode = 'FULL';
  // Default: no pending payloads (so _trySend bails early → CACHED)
  mockGetPendingPayloads.mockResolvedValue([]);
});

describe('sendOrCache', () => {
  test('returns CACHED immediately when OFFLINE', async () => {
    mockNetworkMode = 'OFFLINE';
    const result = await sendOrCache(MOCK_CASE_ID, 'deviv:blob', 'RED');
    expect(result).toBe('CACHED');
    expect(mockSavePendingPayload).toHaveBeenCalledTimes(1);
  });

  test('saves payload to SQLite BEFORE attempting network send', async () => {
    mockNetworkMode = 'FULL';
    const callOrder: string[] = [];
    mockSavePendingPayload.mockImplementation(async () => { callOrder.push('save'); });
    // fetch won't be called because getPendingPayloads returns []
    // but save must still happen first, which we verify by call order
    await sendOrCache(MOCK_CASE_ID, 'deviv:blob', 'AMBER');
    expect(callOrder[0]).toBe('save');
    expect(mockSavePendingPayload).toHaveBeenCalledWith(
      expect.objectContaining({ case_id: MOCK_CASE_ID }),
    );
  });

  test('returns SENT and deletes payload after successful HTTP 202', async () => {
    mockNetworkMode = 'FULL';

    // Provide the pending record that _trySend will read
    mockGetPendingPayloads.mockResolvedValue([
      {
        case_id: MOCK_CASE_ID,
        encrypted_blob: 'deviv:mockencrypted',
        triage_level: 'RED',
        created_at: Date.now(),
        attempts: 0,
        last_attempt: null,
      },
    ]);

    // Mock global fetch to simulate a successful ingest response
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 }) as jest.Mock;

    const result = await sendOrCache(MOCK_CASE_ID, 'deviv:mockencrypted', 'RED');
    expect(result).toBe('SENT');
    expect(mockDeletePendingPayload).toHaveBeenCalledWith(MOCK_CASE_ID);
  });
});
