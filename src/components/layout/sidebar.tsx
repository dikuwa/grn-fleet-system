'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { APP_SHORT_NAME } from '@/lib/constants';
import {
  LayoutDashboard,
  FileText,
  ClipboardCheck,
  ClipboardList,
  Truck,
  Gauge,
  Fuel,
  Wrench,
  Users,
  Building2,
  CarFront,
  FileSpreadsheet,
  FileBarChart,
  Bell,
  Settings,
  ChevronLeft,
  Globe,
  MapPin,
  Shield,
  BrainCircuit,
  Receipt,
  User,
  CalendarClock,
  Clock,
  Mail,
  Layers,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Requests & Approvals',
    items: [
      { label: 'My Requests', href: '/dashboard/requests', icon: FileText },
      { label: 'Approvals', href: '/dashboard/approvals', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Allocations & Trips',
    items: [
      { label: 'Allocations', href: '/dashboard/allocations', icon: Truck },
      { label: 'Trips', href: '/dashboard/trips', icon: Gauge, badge: 0 },
      { label: 'Active Trips', href: '/dashboard/trips/active', icon: Gauge },
      { label: 'Closure Review', href: '/dashboard/trips/closure-review', icon: Clock },
      { label: 'Daily Logs', href: '/dashboard/logs', icon: ClipboardCheck },
      { label: 'Fuel Records', href: '/dashboard/fuel', icon: Fuel },
      { label: 'Reimbursements', href: '/dashboard/reimbursements', icon: ClipboardList },
    ],
  },
  {
    label: 'Fleet & Maintenance',
    items: [
      { label: 'Fleet', href: '/dashboard/fleet', icon: CarFront },
      { label: 'Import Vehicles', href: '/dashboard/fleet/import', icon: Truck },
      { label: 'Fleet Map', href: '/dashboard/fleet/map', icon: MapPin },
      { label: 'Compliance', href: '/dashboard/fleet/compliance', icon: Shield },
      { label: 'Expiry Alerts', href: '/dashboard/expiry-alerts', icon: CalendarClock },
      { label: 'Predictive Maint.', href: '/dashboard/fleet/predictive-maintenance', icon: BrainCircuit },
      { label: 'Expenses', href: '/dashboard/fleet/expenses', icon: Receipt },
      { label: 'Maintenance', href: '/dashboard/maintenance', icon: Wrench },
      { label: 'Inspections', href: '/dashboard/inspections', icon: ClipboardCheck },
    ],
  },
  {
    label: 'People & Offices',
    items: [
      { label: 'Staff Directory', href: '/dashboard/staff', icon: Users },
      { label: 'Drivers', href: '/dashboard/drivers', icon: CarFront },
      { label: 'Offices', href: '/dashboard/offices', icon: Building2 },
      { label: 'Departments', href: '/dashboard/departments', icon: Layers },
    ],
  },
  {
    label: 'Documents & Reports',
    items: [
      { label: 'Documents', href: '/dashboard/documents', icon: FileSpreadsheet },
      { label: 'Reports', href: '/dashboard/reports', icon: FileBarChart },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications', icon: Bell },
      { label: 'Email History', href: '/dashboard/notifications/history', icon: Mail },
      { label: 'Audit Log', href: '/dashboard/audit', icon: FileText },
      { label: 'Settings', href: '/dashboard/settings', icon: Settings },
      { label: 'User Management', href: '/dashboard/admin/users', icon: Users },
      { label: 'Roles & Permissions', href: '/dashboard/admin/roles', icon: Shield },
      { label: 'Regions', href: '/dashboard/admin/regions', icon: MapPin },
      { label: 'Tenants', href: '/dashboard/platform/tenants', icon: Globe },
      { label: 'Platform Dashboard', href: '/dashboard/platform', icon: LayoutDashboard },
      { label: 'Driver Console', href: '/dashboard/driver-mobile', icon: Gauge },
      { label: 'Driver Self-Service', href: '/dashboard/driver-self-service', icon: User },
      { label: 'Onboard Tenant', href: '/dashboard/platform/onboard', icon: LayoutDashboard },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [activeTripCount, setActiveTripCount] = useState(0);

  useEffect(() => {
    fetch('/api/reports?type=snapshot&metric=activeTrips')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.data?.activeTrips != null) setActiveTripCount(Number(d.data.activeTrips));
      })
      .catch(() => {/* silent */});
  }, []);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-brand-900 transition-all duration-200',
        collapsed ? 'w-[72px]' : 'w-[248px]',
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white">
          G
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold text-white">{APP_SHORT_NAME}</span>
        )}
        <button
          onClick={onToggle}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white transition-colors"
        >
          <ChevronLeft
            className={cn(
              'h-4 w-4 transition-transform duration-200',
              collapsed && 'rotate-180',
            )}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-none px-2 py-4">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-widest text-white/40">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-[8px] px-2 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-brand-950/50 text-white'
                          : 'text-white/60 hover:bg-white/5 hover:text-white',
                        collapsed && 'justify-center px-0',
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">{item.label}</span>
                          {item.badge !== undefined && item.label === 'Trips' && activeTripCount > 0 && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-medium text-white">
                              {activeTripCount > 99 ? '99+' : activeTripCount}
                            </span>
                          )}
                          {item.badge !== undefined && item.label !== 'Trips' && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-medium text-white">
                              {item.badge}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

/**
 * Mobile sidebar as a slide-over drawer
 */
export function MobileSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[280px] transform border-r border-border bg-brand-900 transition-transform duration-200 md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white">
              G
            </div>
            <span className="text-sm font-semibold text-white">{APP_SHORT_NAME}</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <nav className="overflow-y-auto px-2 py-4">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-widest text-white/40">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className={cn(
                          'flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-sm transition-colors',
                          isActive
                            ? 'bg-brand-950/50 text-white'
                            : 'text-white/60 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" />
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
