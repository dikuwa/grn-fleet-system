'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  resolvedTheme: 'light' | 'dark';
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  resolvedTheme: 'light',
  theme: 'system',
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = 'govfleet-theme';

/**
 * Get the stored theme preference. Returns 'light', 'dark', or null.
 */
function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return null;
}

/**
 * Resolve a theme preference to an actual 'light' or 'dark' value.
 */
function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  // Hydrate on mount
  useEffect(() => {
    const stored = getStoredTheme();
    const initial: Theme = stored ?? 'system';
    setThemeState(initial);
    setResolvedTheme(resolveTheme(initial));
    setMounted(true);
  }, []);

  // Apply theme class whenever resolved theme changes
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    // Set color-scheme for native controls
    root.style.colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  }, [resolvedTheme, mounted]);

  // Persist theme preference
  useEffect(() => {
    if (!mounted) return;
    const stored = getStoredTheme();
    if (stored !== theme) {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme, mounted]);

  // Listen for system preference changes when in 'system' mode
  useEffect(() => {
    if (!mounted) return;
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      // Cycle: dark ↔ light, skip 'system' for toggle button
      return prev === 'dark' ? 'light' : 'dark';
    });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  // Keep resolved theme in sync with theme state (for 'system' mode transitions)
  useEffect(() => {
    if (!mounted) return;
    setResolvedTheme(resolveTheme(theme));
  }, [theme, mounted]);

  const value = useMemo(
    () => ({ resolvedTheme, theme, toggleTheme, setTheme }),
    [resolvedTheme, theme, toggleTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
