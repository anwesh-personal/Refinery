import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeName = 'dark' | 'aqua' | 'minimal';
export type ThemeMode = 'dark' | 'light';

export const THEME_META: Record<ThemeName, { label: string; icon: string; description: string }> = {
  dark:    { label: 'Obsidian', icon: '🌑', description: 'Deep charcoal with amber accents' },
  aqua:    { label: 'Aqua',    icon: '🌊', description: 'Deep ocean with neon teal accents' },
  minimal: { label: 'Minimal', icon: '⬜', description: 'Clean slate — focus on the data' },
};

interface ThemeContextType {
  theme: ThemeName;
  mode: ThemeMode;
  setTheme: (t: ThemeName) => void;
  toggleMode: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('rn-theme') as ThemeName;
    return (saved && saved in THEME_META) ? saved : 'dark';
  });

  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('rn-mode') as ThemeMode;
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('rn-theme', theme);
    localStorage.setItem('rn-mode', mode);
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-mode', mode);
  }, [theme, mode]);

  const setTheme = (t: ThemeName) => setThemeState(t);
  const toggleMode = () => setMode(m => m === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, toggleMode, isDark: mode === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
