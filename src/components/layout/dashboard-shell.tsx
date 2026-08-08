'use client';

import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { Sidebar, MobileBottomNav, MobileSidebar } from '@/components/layout/sidebar';
import { useAttentionBadges } from '@/lib/use-attention-badges';
import { Topbar } from '@/components/layout/topbar';
import { OfflineIndicator } from '@/components/ui/offline-status';
import { OfflineSyncHandler } from '@/components/ui/offline-sync-handler';
import { InstallPwaBanner } from '@/components/ui/install-pwa-banner';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { cn } from '@/lib/utils';
import type { WorkspaceId } from '@/lib/workspaces';

interface DashboardShellProps {
  children: React.ReactNode;
  tenantName?: string;
  userId?: string;
  userName?: string | null;
  userEmail?: string;
  roleNames: string[];
  activeWorkspace: WorkspaceId;
  eligibleWorkspaces: Array<{ id: WorkspaceId; label: string }>;
}

export function DashboardShell({
  children,
  tenantName,
  userId,
  userName,
  userEmail,
  roleNames,
  activeWorkspace,
  eligibleWorkspaces,
}: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Live attention badge counts, fetched once per workspace change and shared
  // by the desktop sidebar and the mobile bottom nav.
  const badgeCounts = useAttentionBadges(activeWorkspace);

  return (
    <div className="bg-canvas min-h-screen transition-colors duration-200">
      {/* Desktop sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeWorkspace={activeWorkspace}
        badgeCounts={badgeCounts}
      />

      {/* Mobile sidebar */}
      <MobileSidebar
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        activeWorkspace={activeWorkspace}
        tenantName={tenantName}
        workspaceLabel={
          eligibleWorkspaces.find((workspace) => workspace.id === activeWorkspace)?.label
        }
      />

      {/* Main content area */}
      <div
        className={cn(
          'min-w-0 transition-all duration-200',
          sidebarCollapsed ? 'md:ml-[72px]' : 'md:ml-[248px]',
        )}
      >
        <Topbar
          onMenuClick={() => setMobileMenuOpen(true)}
          tenantName={tenantName}
          userId={userId}
          userName={userName}
          userEmail={userEmail}
          roleNames={roleNames}
          activeWorkspace={activeWorkspace}
          eligibleWorkspaces={eligibleWorkspaces}
          attentionBadgeCounts={badgeCounts}
        />

        <main className="page-enter mx-auto max-w-[1440px] min-w-0 px-3 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] min-[360px]:px-4 sm:py-6 md:px-6 md:pb-6 lg:px-8">
          <ErrorBoundary label="Dashboard">{children}</ErrorBoundary>
        </main>
        <OfflineIndicator />
        <OfflineSyncHandler />
        <InstallPwaBanner />
        <MobileBottomNav
          activeWorkspace={activeWorkspace}
          onMore={() => setMobileMenuOpen(true)}
          badgeCounts={badgeCounts}
        />
      </div>

      {/* Global notification toaster — one instance for all dashboard pages */}
      <Toaster
        position="top-right"
        gutter={8}
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--color-surface)',
            color: 'var(--color-ink-950)',
            border: '1px solid var(--color-border)',
            borderRadius: '10px',
            boxShadow: '0 4px 16px rgb(0 0 0 / 0.08)',
            fontFamily: 'var(--font-onest), sans-serif',
            fontSize: '14px',
            padding: '12px 16px',
            maxWidth: '400px',
          },
          success: {
            style: {
              background: 'var(--color-status-success-bg)',
              color: 'var(--color-status-success-text)',
              border: '1px solid var(--color-status-success-bg)',
            },
            iconTheme: {
              primary: 'var(--color-status-success-text)',
              secondary: 'var(--color-status-success-bg)',
            },
          },
          error: {
            style: {
              background: 'var(--color-status-error-bg)',
              color: 'var(--color-status-error-text)',
              border: '1px solid var(--color-status-error-bg)',
            },
            iconTheme: {
              primary: 'var(--color-status-error-text)',
              secondary: 'var(--color-status-error-bg)',
            },
          },
          loading: {
            style: {
              background: 'var(--color-status-pending-bg)',
              color: 'var(--color-status-pending-text)',
              border: '1px solid var(--color-status-pending-bg)',
            },
            iconTheme: {
              primary: 'var(--color-status-pending-text)',
              secondary: 'var(--color-status-pending-bg)',
            },
          },
        }}
      />
    </div>
  );
}
