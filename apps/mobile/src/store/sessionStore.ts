import { create } from 'zustand';

export const SESSION_TIMEOUT_MS = 17 * 60 * 1000; // 17 minutes

interface SessionState {
  isSignedIn: boolean;
  lastActivityAt: number;
  signIn: () => void;
  signOut: () => void;
  recordActivity: () => void;
  isExpired: () => boolean;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  isSignedIn: false,
  lastActivityAt: 0,

  signIn: () => set({ isSignedIn: true, lastActivityAt: Date.now() }),

  signOut: () => set({ isSignedIn: false, lastActivityAt: 0 }),

  recordActivity: () => set({ lastActivityAt: Date.now() }),

  isExpired: () => {
    const { isSignedIn, lastActivityAt } = get();
    if (!isSignedIn) return false;
    return Date.now() - lastActivityAt > SESSION_TIMEOUT_MS;
  },
}));

export const sessionStore = useSessionStore;
