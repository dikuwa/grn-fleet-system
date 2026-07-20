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
}

export function DashboardShell({ children, tenantName, userId }: DashboardShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Mobile sidebar */}
      <MobileSidebar
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main content */}
      <div
        className={cn(
          'transition-all duration-200',
          sidebarCollapsed ? 'ml-[72px]' : 'ml-[248px]',
        )}
      >
        <Topbar onMenuClick={() => setMobileMenuOpen(true)} tenantName={tenantName} userId={userId} />

        <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 lg:px-8 page-enter">
          <ErrorBoundary label="Dashboard">
            {children}
          </ErrorBoundary>
        </main>
        <OfflineIndicator />
        <OfflineSyncHandler />
        <InstallPwaBanner />
        <div id="toast-container" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2 sm:max-w-[420px]" />
      </div>
    </div>
  );
}
