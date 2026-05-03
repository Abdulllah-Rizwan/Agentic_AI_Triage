import { create } from 'zustand';

export type NetworkMode = 'OFFLINE' | 'DEGRADED' | 'FULL';

interface NetworkState {
  mode: NetworkMode;
  isConnected: boolean;
  lastChecked: number;
  setMode: (mode: NetworkMode) => void;
  setConnected: (connected: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  mode: 'OFFLINE',
  isConnected: false,
  lastChecked: 0,
  setMode: (mode) => set({ mode, lastChecked: Date.now() }),
  setConnected: (isConnected) => set({ isConnected }),
}));

export const networkStore = useNetworkStore;
