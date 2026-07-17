'use client';

import { useState } from 'react';
import { Bell, Search, User, Menu, LogOut } from 'lucide-react';

interface TopbarProps {
  onMenuClick: () => void;
  tenantName?: string;
}

export function Topbar({ onMenuClick, tenantName }: TopbarProps) {
  const [showProfile, setShowProfile] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-white px-4 md:px-6">
      {/* Mobile menu trigger */}
      <button
        onClick={onMenuClick}
        className="flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-muted md:hidden"
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

      <div className="ml-auto flex items-center gap-2">
        {/* Notifications */}
        <button className="relative flex h-9 w-9 items-center justify-center rounded-[8px] text-ink-500 hover:bg-muted transition-colors">
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-status-error-text" />
        </button>

        {/* Profile */}
        <div className="relative">
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex h-9 items-center gap-2 rounded-[8px] px-2 text-ink-500 hover:bg-muted transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand-50 text-xs font-semibold text-brand-800">
              KA
            </div>
            <span className="hidden text-sm text-ink-700 md:inline">K. Amupanda</span>
          </button>

          {showProfile && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowProfile(false)}
              />
              <div className="absolute right-0 top-12 z-50 w-56 rounded-[10px] border border-border bg-surface p-1 shadow-lg">
                <div className="border-b border-border px-3 py-2.5">
                  <p className="text-sm font-medium text-ink-950">Kandjimi Amupanda</p>
                  <p className="text-xs text-ink-500">Transport Administrator</p>
                  <p className="text-xs text-ink-500">{tenantName || 'Loading...'}</p>
                </div>
                <div className="mt-1 space-y-0.5">
                  <button className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-ink-700 hover:bg-muted transition-colors">
                    <User className="h-4 w-4" />
                    Profile
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-ink-700 hover:bg-muted transition-colors">
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
