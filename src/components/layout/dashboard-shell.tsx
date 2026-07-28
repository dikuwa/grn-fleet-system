'use client';

import { useState } from 'react';
import { Sidebar, MobileSidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { OfflineIndicator } from '@/components/ui/offline-status';
import { OfflineSyncHandler } from '@/components/ui/offline-sync-handler';
import { InstallPwaBanner } from '@/components/ui/install-pwa-banner';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { cn } from '@/lib/utils';

interface DashboardShellProps {
  children: React.ReactNode;
  tenantName?: string;
  userId?: string;
  roleNames: string[];
}

export function DashboardShell({ children, tenantName, userId, roleNames }: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas transition-colors duration-200">
      {/* Desktop sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        roleNames={roleNames}
      />

      {/* Mobile sidebar */}
      <MobileSidebar
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        roleNames={roleNames}
      />

      {/* Main content area */}
      <div
        className={cn(
          'min-w-0 transition-all duration-200',
          sidebarCollapsed ? 'md:ml-[72px]' : 'md:ml-[248px]',
        )}
      >
        <Topbar onMenuClick={() => setMobileMenuOpen(true)} tenantName={tenantName} userId={userId} roleNames={roleNames} />

        <main className="mx-auto min-w-0 max-w-[1440px] px-4 py-6 md:px-6 lg:px-8 page-enter">
          <ErrorBoundary label="Dashboard">
            {children}
          </ErrorBoundary>
        </main>
        <OfflineIndicator />
        <OfflineSyncHandler />
        <InstallPwaBanner />
      </div>
    </div>
  );
}
