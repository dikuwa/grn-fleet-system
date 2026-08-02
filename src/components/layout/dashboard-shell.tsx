'use client';

import { useState } from 'react';
import { Sidebar, MobileBottomNav, MobileSidebar } from '@/components/layout/sidebar';
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

  return (
    <div className="bg-canvas min-h-screen transition-colors duration-200">
      {/* Desktop sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeWorkspace={activeWorkspace}
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
        />

        <main className="page-enter mx-auto max-w-[1440px] min-w-0 px-3 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] min-[360px]:px-4 sm:py-6 md:px-6 md:pb-6 lg:px-8">
          <ErrorBoundary label="Dashboard">{children}</ErrorBoundary>
        </main>
        <OfflineIndicator />
        <OfflineSyncHandler />
        <InstallPwaBanner />
        <MobileBottomNav activeWorkspace={activeWorkspace} onMore={() => setMobileMenuOpen(true)} />
      </div>
    </div>
  );
}
