'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  User,
  Menu,
  LogOut,
  Settings,
  ChevronDown,
  Building2,
  Download,
  BriefcaseBusiness,
  Check,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { getRoleLabel } from '@/lib/role-labels';
import { fetchUserProfile, userProfileQueryKey, type UserProfileData } from '@/lib/user-profile';
import { ThemeSelector } from '@/components/layout/theme-selector';
import {
  fetchNotifications,
  notificationQueryKey,
  useNotificationBroadcast,
} from '@/lib/notifications-client';
import { GlobalSearch } from '@/components/layout/global-search';
import { UserAvatar } from '@/components/ui/user-avatar';
import { SystemRoles } from '@/lib/dashboard-access';
import { usePwaInstallState, IosInstallDialog } from '@/components/ui/install-pwa-banner';
import type { WorkspaceId } from '@/lib/workspaces';

interface TopbarProps {
  onMenuClick: () => void;
  tenantName?: string;
  userId?: string;
  userName?: string | null;
  userEmail?: string;
  roleNames: string[];
  activeWorkspace: WorkspaceId;
  eligibleWorkspaces: Array<{ id: WorkspaceId; label: string }>;
  /** Live workspace attention counts (shared from DashboardShell). */
  attentionBadgeCounts?: Record<string, number>;
}

export function Topbar({
  onMenuClick,
  tenantName,
  userId,
  userName,
  userEmail,
  roleNames,
  activeWorkspace,
  eligibleWorkspaces,
  attentionBadgeCounts = {},
}: TopbarProps) {
  const queryClient = useQueryClient();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [switchingWorkspace, setSwitchingWorkspace] = useState<WorkspaceId | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const pwa = usePwaInstallState();
  useNotificationBroadcast();

  const { data: profile = null } = useQuery<UserProfileData>({
    queryKey: [...userProfileQueryKey, userId],
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
  // Total workspace attention (approvals to action, trips to action, drafts…)
  // surfaced next to the notification bell for an at-a-glance top-of-screen
  // indicator. Distinct from unread notifications (red pill on the right).
  const attentionTotal = Object.values(attentionBadgeCounts).reduce(
    (sum, count) => sum + (Number(count) || 0),
    0,
  );

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

  const displayName =
    profile?.name ||
    profile?.email?.split('@')[0] ||
    userName ||
    userEmail?.split('@')[0] ||
    'User';
  const roleLabel = profile?.roles?.[0]
    ? getRoleLabel(profile.roles[0].roleName)
    : roleNames[0]
      ? getRoleLabel(roleNames[0])
      : undefined;
  const avatarSrc = profile?.image;
  const activeWorkspaceLabel =
    eligibleWorkspaces.find((workspace) => workspace.id === activeWorkspace)?.label ??
    'Personal Requester';

  const switchWorkspace = async (workspace: WorkspaceId) => {
    if (workspace === activeWorkspace || switchingWorkspace) return;
    setSwitchingWorkspace(workspace);
    try {
      const response = await fetch('/api/workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      });
      if (!response.ok) throw new Error('Workspace switch failed');
      setShowAccountMenu(false);
      window.location.assign('/dashboard');
    } finally {
      setSwitchingWorkspace(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' });
    } catch {
      /* ignore */
    }
    queryClient.clear();
    window.location.assign('/login');
  };

  return (
    <header className="border-border bg-surface pt-safe sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b px-3 min-[360px]:gap-3 min-[360px]:px-4 md:gap-4 md:px-6">
      {/* Mobile menu trigger */}
      <button
        onClick={onMenuClick}
        className="focus-ring text-ink-500 hover:bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] md:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1">
        <ThemeSelector />

        {/* Notifications + workspace attention */}
        <Link
          href="/dashboard/notifications"
          className="text-ink-500 hover:bg-muted relative flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}${
            attentionTotal > 0
              ? `, ${attentionTotal} item${attentionTotal === 1 ? '' : 's'} need your attention`
              : ''
          }`}
          title={
            attentionTotal > 0
              ? `${attentionTotal} item${attentionTotal === 1 ? '' : 's'} need your attention`
              : undefined
          }
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="bg-status-error-text absolute -top-0.5 -right-0.5 flex min-w-[18px] items-center justify-center rounded-full px-1 py-0.5 text-[10px] leading-none font-bold text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          {attentionTotal > 0 && (
            <span
              aria-hidden="true"
              className="bg-amber-500 absolute -top-0.5 -left-0.5 flex min-w-[18px] items-center justify-center rounded-full px-1 py-0.5 text-[10px] leading-none font-bold text-white"
            >
              {attentionTotal > 99 ? '99+' : attentionTotal}
            </span>
          )}
          {unreadCount === 0 && attentionTotal === 0 && !notificationQuery.isError && (
            <span className="bg-ink-300 absolute top-1.5 right-1.5 h-2 w-2 rounded-full" />
          )}
        </Link>

        {/* Account trigger */}
        <div className="relative" ref={accountRef}>
          <button
            onClick={() => setShowAccountMenu(!showAccountMenu)}
            className="text-ink-500 hover:bg-muted flex min-h-9 items-center gap-2 rounded-[8px] px-2 py-1 transition-colors"
            aria-label="Open account menu"
            aria-expanded={showAccountMenu}
          >
            {/* Avatar */}
            <UserAvatar
              src={avatarSrc}
              name={displayName}
              className="h-7 w-7 rounded-[6px] text-xs"
            />
            {/* Compact identity block (hidden on small mobile) */}
            <span className="hidden max-w-[140px] min-w-0 flex-col items-start leading-tight sm:flex">
              <span className="text-ink-700 dark:text-ink-300 w-full truncate text-[13px] font-medium">
                {displayName}
              </span>
              {roleLabel && (
                <span className="text-ink-500 w-full truncate text-[11px]">
                  {activeWorkspaceLabel}
                </span>
              )}
            </span>
            <ChevronDown className="text-ink-400 hidden h-3.5 w-3.5 sm:block" />
          </button>

          {/* Account dropdown */}
          {showAccountMenu && (
            <div className="border-border bg-surface fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top,0px))] z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-[10px] border p-1 shadow-lg min-[360px]:left-auto min-[360px]:w-72 sm:absolute sm:inset-x-auto sm:top-10 sm:right-0 sm:w-64 dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
              {/* User info header */}
              <div className="border-border border-b px-3 py-3">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    src={avatarSrc}
                    name={displayName}
                    className="h-10 w-10 shrink-0 rounded-[8px] text-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-950 dark:text-ink-100 truncate text-sm font-medium">
                      {displayName}
                    </p>
                    {roleLabel && <p className="text-ink-500 truncate text-xs">{roleLabel}</p>}
                    {tenantName && <p className="text-ink-500 truncate text-xs">{tenantName}</p>}
                  </div>
                </div>
              </div>

              {eligibleWorkspaces.length > 1 && (
                <div className="border-border border-b px-1 py-2">
                  <p className="text-ink-400 px-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
                    Active workspace
                  </p>
                  {eligibleWorkspaces.map((workspace) => {
                    const selected = workspace.id === activeWorkspace;
                    const switching = workspace.id === switchingWorkspace;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => void switchWorkspace(workspace.id)}
                        disabled={Boolean(switchingWorkspace)}
                        className="text-ink-700 hover:bg-muted dark:text-ink-300 flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-sm transition-colors disabled:opacity-60 dark:hover:bg-white/[0.06]"
                      >
                        <BriefcaseBusiness className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{workspace.label}</span>
                        {switching ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : selected ? (
                          <Check className="text-brand-700 h-4 w-4" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Menu items */}
              <div className="mt-1 space-y-0.5">
                <Link
                  href="/dashboard/profile"
                  className="text-ink-700 hover:bg-muted dark:text-ink-300 flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm transition-colors dark:hover:bg-white/[0.06]"
                  onClick={() => setShowAccountMenu(false)}
                >
                  <User className="h-4 w-4" />
                  My Profile
                </Link>
                {roleNames.includes(SystemRoles.TENANT_ADMIN) && (
                  <Link
                    href="/dashboard/settings"
                    className="text-ink-700 hover:bg-muted dark:text-ink-300 flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm transition-colors dark:hover:bg-white/[0.06]"
                    onClick={() => setShowAccountMenu(false)}
                  >
                    <Settings className="h-4 w-4" />
                    Tenant Settings
                  </Link>
                )}

                {/* Tenant context */}
                {profile?.tenantSlug && (
                  <div className="text-ink-500 flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm">
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{profile.tenantSlug}</span>
                  </div>
                )}

                {pwa.state !== 'installed' && pwa.state !== 'unsupported' && (
                  <button
                    onClick={async () => {
                      if (pwa.state === 'can-install') {
                        await pwa.promptInstall();
                      } else if (pwa.state === 'ios') {
                        setShowIosInstall(true);
                      }
                      setShowAccountMenu(false);
                    }}
                    className="text-ink-700 hover:bg-muted dark:text-ink-300 flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm transition-colors dark:hover:bg-white/[0.06]"
                  >
                    <Download className="h-4 w-4" />
                    Install GovFleet App
                  </button>
                )}

                <div className="border-border my-1 border-t" />

                <button
                  onClick={handleSignOut}
                  className="text-ink-700 hover:bg-muted dark:text-ink-300 flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm transition-colors dark:hover:bg-white/[0.06]"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <IosInstallDialog open={showIosInstall} onClose={() => setShowIosInstall(false)} />
    </header>
  );
}
