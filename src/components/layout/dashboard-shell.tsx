'use client';

import { useState } from 'react';
import { Sidebar, MobileSidebar } from '@/components/layout/sidebar';
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
  roleNames: string[];
  activeWorkspace: WorkspaceId;
  eligibleWorkspaces: Array<{ id: WorkspaceId; label: string }>;
}

export function DashboardShell({
  children,
  tenantName,
  userId,
  roleNames,
  activeWorkspace,
  eligibleWorkspaces,
}: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="bg-canvas min-h-screen overflow-x-hidden transition-colors duration-200">
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
          roleNames={roleNames}
          activeWorkspace={activeWorkspace}
          eligibleWorkspaces={eligibleWorkspaces}
        />

        <main className="page-enter mx-auto max-w-[1440px] min-w-0 px-4 py-6 md:px-6 lg:px-8">
          <ErrorBoundary label="Dashboard">{children}</ErrorBoundary>
        </main>
        <OfflineIndicator />
        <OfflineSyncHandler />
        <InstallPwaBanner />
      </div>
    </div>
  );
}
