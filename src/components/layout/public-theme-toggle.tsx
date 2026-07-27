import { ThemeSelector } from '@/components/layout/theme-selector';

/**
 * Dark mode toggle button for public pages (landing, login, contact, privacy).
 * Renders a Sun icon in dark mode (to switch to light) and Moon in light mode.
 */
export function PublicThemeToggle() {
  return <ThemeSelector />;
}
