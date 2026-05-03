import { create } from 'zustand';
import * as Device from 'expo-device';
import * as Constants from 'expo-constants';
import { getUserProfile, UserProfile } from '../db/queries';

interface UserState {
  profile: UserProfile | null;
  isRegistered: boolean;
  deviceId: string;
  setProfile: (profile: UserProfile) => void;
  setRegistered: (registered: boolean) => void;
  loadFromDatabase: () => Promise<void>;
}

function getDeviceId(): string {
  const installationId = Constants.default?.installationId;
  if (installationId) return installationId;
  const deviceName = Device.deviceName ?? 'unknown';
  const brand = Device.brand ?? 'unknown';
  return `${brand}-${deviceName}`.replace(/\s+/g, '-').toLowerCase();
}

export const useUserStore = create<UserState>((set) => ({
  profile: null,
  isRegistered: false,
  deviceId: getDeviceId(),
  setProfile: (profile) => set({ profile, isRegistered: true }),
  setRegistered: (isRegistered) => set({ isRegistered }),
  loadFromDatabase: async () => {
    const profile = await getUserProfile();
    if (profile) {
      set({ profile, isRegistered: true });
    }
  },
}));

export const userStore = useUserStore;
