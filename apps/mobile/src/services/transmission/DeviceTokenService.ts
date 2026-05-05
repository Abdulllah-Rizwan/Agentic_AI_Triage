import * as SecureStore from 'expo-secure-store';
import * as Constants from 'expo-constants';
import * as Device from 'expo-device';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const TOKEN_KEY = 'medireach_device_token';
const TOKEN_EXPIRY_KEY = 'medireach_device_token_expiry';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

class DeviceTokenService {
  /**
   * Returns a valid device JWT, refreshing it if expired or absent.
   * Persists the token in SecureStore so the server is only called once per 30 days.
   */
  async getDeviceToken(): Promise<string> {
    try {
      const [token, expiryStr] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(TOKEN_EXPIRY_KEY),
      ]);

      if (token && expiryStr) {
        const expiry = parseInt(expiryStr, 10);
        if (Date.now() < expiry) return token;
      }
    } catch {
      // SecureStore unavailable — fall through to registration
    }

    return this.registerDevice();
  }

  /** Registers this device with the server and persists the returned JWT. */
  async registerDevice(): Promise<string> {
    const deviceId =
      Constants.default?.installationId ??
      (Constants.default as Record<string, unknown>)?.deviceId as string ??
      'unknown-device';

    const response = await fetch(`${API_BASE_URL}/api/v1/auth/device-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        device_model: Device.modelName ?? 'unknown',
        app_version: Constants.default?.expoConfig?.version ?? '1.0.0',
      }),
    });

    if (!response.ok) {
      throw new Error(`Device registration failed: ${response.status}`);
    }

    const { token } = (await response.json()) as { token: string };

    try {
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_KEY, token),
        SecureStore.setItemAsync(TOKEN_EXPIRY_KEY, (Date.now() + THIRTY_DAYS_MS).toString()),
      ]);
    } catch {
      // SecureStore unavailable — token will be re-fetched next cold start
    }

    return token;
  }

  /** Removes the stored token. Called on 401 or app reset. */
  async clearDeviceToken(): Promise<void> {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(TOKEN_KEY),
        SecureStore.deleteItemAsync(TOKEN_EXPIRY_KEY),
      ]);
    } catch {
      // Already cleared or SecureStore unavailable
    }
  }
}

export const deviceTokenService = new DeviceTokenService();
