'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  User,
  Menu,
  LogOut,
  Settings,
  ChevronDown,
  Building2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getRoleLabel } from '@/lib/role-labels';
import {
  fetchUserProfile,
  userProfileQueryKey,
  type UserProfileData,
} from '@/lib/user-profile';
import { ThemeSelector } from '@/components/layout/theme-selector';
import {
  fetchNotifications,
  notificationQueryKey,
  useNotificationBroadcast,
} from '@/lib/notifications-client';
import { GlobalSearch } from '@/components/layout/global-search';
import { UserAvatar } from '@/components/ui/user-avatar';

interface TopbarProps {
  onMenuClick: () => void;
  tenantName?: string;
  userId?: string;
}

export function Topbar({ onMenuClick, userId }: TopbarProps) {
  const router = useRouter();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  useNotificationBroadcast();

  const { data: profile = null } = useQuery<UserProfileData>({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  const notificationQuery = useQuery({
    queryKey: notificationQueryKey,
    queryFn: ({ signal }) => fetchNotifications(signal),
    enabled: Boolean(userId),
    staleTime: 3_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const unreadCount = notificationQuery.data?.unreadCount || 0;

  // Close menus on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
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
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const displayName = profile?.name || profile?.email?.split('@')[0] || 'User';
  const jobTitle = profile?.employee?.jobTitle || (profile?.roles?.[0] ? getRoleLabel(profile.roles[0].roleName) : undefined);
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

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1">
        <ThemeSelector />

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
          {unreadCount === 0 && !notificationQuery.isError && (
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
            <UserAvatar src={avatarSrc} name={displayName} className="h-7 w-7 rounded-[6px] text-xs" />
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
                  <UserAvatar src={avatarSrc} name={displayName} className="h-10 w-10 shrink-0 rounded-[8px] text-sm" />
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
