'use client';

import { useTheme } from '@/lib/theme-provider';
import { Sun, Moon } from 'lucide-react';

/**
 * Dark mode toggle button for public pages (landing, login, contact, privacy).
 * Renders a Sun icon in dark mode (to switch to light) and Moon in light mode.
 */
export function PublicThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun className="h-[18px] w-[18px] theme-icon-enter" />
      ) : (
        <Moon className="h-[18px] w-[18px] theme-icon-enter" key={theme} />
      )}
    </button>
  );
}
