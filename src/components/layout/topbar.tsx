'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Bell,
  Search,
  User,
  Menu,
  LogOut,
  Sun,
  Moon,
  Settings,
  ChevronDown,
  Building2,
  Monitor,
} from 'lucide-react';
import Link from 'next/link';
import { useTheme } from '@/lib/theme-provider';
import { useRouter } from 'next/navigation';
import { getRoleLabel } from '@/lib/role-labels';

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  employee?: {
    firstName: string;
    lastName: string;
    jobTitle: string | null;
  } | null;
  roles?: Array<{ roleName: string; isActing: boolean }>;
  tenantSlug?: string;
}

interface TopbarProps {
  onMenuClick: () => void;
  tenantName?: string;
  userId?: string;
}

export function Topbar({ onMenuClick, tenantName, userId }: TopbarProps) {
  const router = useRouter();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifError, setNotifError] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { resolvedTheme, theme, toggleTheme, setTheme } = useTheme();
  const accountRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);

  // Load user profile
  useEffect(() => {
    if (!userId) return;
    fetch('/api/users/profile')
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        if (json?.success && json?.data) setProfile(json.data);
      })
      .catch(() => {});
  }, [userId]);

  // Fetch unread notification count
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await fetch(`/api/notifications?userId=${userId}&limit=1&unreadOnly=true`);
        if (!res.ok) throw new Error('Failed');
        const json = await res.json();
        if (!cancelled && json?.success) {
          setUnreadCount(json.data?.totalUnread ?? json.data?.notifications?.length ?? 0);
          setNotifError(false);
        }
      } catch {
        if (!cancelled) setNotifError(true);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [userId]);

  // Close menus on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setShowThemeMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAccountMenu(false);
        setShowThemeMenu(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const displayName = profile?.name || profile?.email?.split('@')[0] || 'User';
  const jobTitle = profile?.employee?.jobTitle || (profile?.roles?.[0] ? getRoleLabel(profile.roles[0].roleName) : undefined);
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const avatarSrc = profile?.image;

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' });
    } catch { /* ignore */ }
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-surface px-4 md:px-6">
      {/* Mobile menu trigger */}
      <button
        onClick={onMenuClick}
        className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-muted md:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Search */}
      <div className="relative hidden flex-1 max-w-md md:block">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
        <input
          type="search"
          placeholder="Search requests, vehicles, staff..."
          className="h-10 w-full rounded-[8px] border border-border bg-muted pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:bg-surface"
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        {/* Theme toggle button */}
        <div className="relative flex items-center" ref={themeRef}>
          {/* Direct theme toggle button */}
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-muted transition-colors"
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label={`Current theme: ${theme}. Click to toggle.`}
          >
            {resolvedTheme === 'dark' ? (
              <Moon className="h-[18px] w-[18px] theme-icon-enter" />
            ) : (
              <Sun className="h-[18px] w-[18px] theme-icon-enter" />
            )}
          </button>
          {/* Dropdown indicator for explicit Light/Dark/System selection */}
          <button
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            className="flex h-9 w-4 items-center justify-center rounded-[4px] text-ink-400 hover:text-ink-600 hover:bg-muted transition-colors"
            aria-label="Open theme selection menu"
            title="Select theme"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="h-3 w-3">
              <path d="M2 3L4 5L6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {showThemeMenu && (
            <div className="absolute right-0 top-10 z-50 w-44 rounded-[10px] border border-border bg-surface p-1 shadow-lg dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
              <button
                onClick={() => { setTheme('light'); setShowThemeMenu(false); }}
                className={`flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm transition-colors ${
                  theme === 'light' ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-muted'
                }`}
              >
                <Sun className="h-4 w-4" />
                Light
              </button>
              <button
                onClick={() => { setTheme('dark'); setShowThemeMenu(false); }}
                className={`flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm transition-colors ${
                  theme === 'dark' ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-muted'
                }`}
              >
                <Moon className="h-4 w-4" />
                Dark
              </button>
              <button
                onClick={() => { setTheme('system'); setShowThemeMenu(false); }}
                className={`flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm transition-colors ${
                  theme === 'system' ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-muted'
                }`}
              >
                <Monitor className="h-4 w-4" />
                System
              </button>
            </div>
          )}
        </div>

        {/* Notifications */}
        <Link
          href="/dashboard/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-muted transition-colors"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-status-error-text px-1 py-0.5 text-[10px] font-bold leading-none text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          {unreadCount === 0 && !notifError && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-ink-300" />
          )}
        </Link>

        {/* Account trigger */}
        <div className="relative" ref={accountRef}>
          <button
            onClick={() => setShowAccountMenu(!showAccountMenu)}
            className="flex h-9 items-center gap-2 rounded-[8px] px-2 text-ink-500 hover:bg-muted transition-colors"
            aria-label="Open account menu"
            aria-expanded={showAccountMenu}
          >
            {/* Avatar */}
            <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-[6px] bg-brand-50 text-xs font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-300">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                avatarLetter
              )}
            </div>
            {/* Name (hidden on small mobile) */}
            <span className="hidden text-sm text-ink-700 dark:text-ink-300 sm:inline max-w-[120px] truncate">
              {displayName}
            </span>
            {/* Role (hidden on medium-down) */}
            {jobTitle && (
              <span className="hidden text-xs text-ink-500 lg:inline max-w-[140px] truncate">
                {jobTitle}
              </span>
            )}
            <ChevronDown className="hidden h-3.5 w-3.5 text-ink-400 sm:block" />
          </button>

          {/* Account dropdown */}
          {showAccountMenu && (
            <div className="absolute right-0 top-10 z-50 w-64 rounded-[10px] border border-border bg-surface p-1 shadow-lg dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
              {/* User info header */}
              <div className="border-b border-border px-3 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-brand-50 text-sm font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-300">
                    {avatarSrc ? (
                      <img src={avatarSrc} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      avatarLetter
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-950 dark:text-ink-100">
                      {displayName}
                    </p>
                    {jobTitle && (
                      <p className="truncate text-xs text-ink-500">{jobTitle}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Menu items */}
              <div className="mt-1 space-y-0.5">
                <Link
                  href="/dashboard/profile"
                  className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-ink-700 hover:bg-muted transition-colors dark:text-ink-300 dark:hover:bg-white/[0.06]"
                  onClick={() => setShowAccountMenu(false)}
                >
                  <User className="h-4 w-4" />
                  My Profile
                </Link>
                <Link
                  href="/dashboard/settings"
                  className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-ink-700 hover:bg-muted transition-colors dark:text-ink-300 dark:hover:bg-white/[0.06]"
                  onClick={() => setShowAccountMenu(false)}
                >
                  <Settings className="h-4 w-4" />
                  Account Settings
                </Link>

                {/* Tenant context */}
                {profile?.tenantSlug && (
                  <div className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-ink-500">
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{profile.tenantSlug}</span>
                  </div>
                )}

                <div className="border-t border-border my-1" />

                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-ink-700 hover:bg-muted transition-colors dark:text-ink-300 dark:hover:bg-white/[0.06]"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
