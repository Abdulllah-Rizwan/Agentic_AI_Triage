import { create } from 'zustand';

interface ThemeState {
  isDark: boolean;
  setIsDark: (isDark: boolean) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: true,
  setIsDark: (isDark) => set({ isDark }),
  toggle: () => {
    const newIsDark = !get().isDark;
    set({ isDark: newIsDark });
    // Persist to SQLite via dynamic import to avoid circular deps at module load time
    import('../db/queries').then(({ setMetadata }) => {
      setMetadata('theme_is_dark', newIsDark ? '1' : '0').catch(() => undefined);
    });
  },
}));

export const themeStore = useThemeStore;
