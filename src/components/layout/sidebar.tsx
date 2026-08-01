'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { APP_SHORT_NAME } from '@/lib/constants';
import { canNavigateDashboardPath, SystemRoles } from '@/lib/dashboard-access';
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
  ChevronRight,
  Globe,
  MapPin,
  Shield,
  BrainCircuit,
  Receipt,
  User,
  CalendarClock,
  Clock,
  Mail,
  Send,
  Database,
  Link2,
  GitBranch,
  AlertTriangle,
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
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'My Profile', href: '/dashboard/profile', icon: User },
    ],
  },
  {
    label: 'Driver',
    items: [
      { label: 'Driver Console', href: '/dashboard/driver-mobile', icon: Gauge },
      { label: 'Driver Self-Service', href: '/dashboard/driver-self-service', icon: User },
      { label: 'Daily Logs', href: '/dashboard/logs', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Requests & Approvals',
    items: [
      { label: 'My Requests', href: '/dashboard/requests', icon: FileText },
      { label: 'Programmes', href: '/dashboard/programmes', icon: ClipboardList },
      { label: 'Approvals', href: '/dashboard/approvals', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Allocations & Trips',
    items: [
      { label: 'Allocations', href: '/dashboard/allocations', icon: Truck },
      { label: 'Trips', href: '/dashboard/trips', icon: Gauge, badge: 0 },
      { label: 'Active Trips', href: '/dashboard/trips/active', icon: Gauge },
      { label: 'Release Readiness', href: '/dashboard/trips/readiness', icon: ClipboardCheck },
      { label: 'Closure Review', href: '/dashboard/trips/closure-review', icon: Clock },
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
      {
        label: 'Predictive Maint.',
        href: '/dashboard/fleet/predictive-maintenance',
        icon: BrainCircuit,
      },
      { label: 'Expenses', href: '/dashboard/fleet/expenses', icon: Receipt },
      { label: 'Maintenance', href: '/dashboard/maintenance', icon: Wrench },
      { label: 'Defects', href: '/dashboard/fleet/defects', icon: AlertTriangle },
      { label: 'Inspections', href: '/dashboard/inspections', icon: ClipboardCheck },
      { label: 'Insp. Templates', href: '/dashboard/inspections/templates', icon: ClipboardList },
    ],
  },
  {
    label: 'People & Offices',
    items: [
      { label: 'Staff Directory', href: '/dashboard/staff', icon: Users },
      { label: 'Organisation Structure', href: '/dashboard/organisation', icon: Building2 },
      { label: 'Acting Roles', href: '/dashboard/delegations', icon: CalendarClock },
      { label: 'Drivers', href: '/dashboard/drivers', icon: CarFront },
    ],
  },
  {
    label: 'Documents & Reports',
    items: [
      { label: 'Documents', href: '/dashboard/documents', icon: FileSpreadsheet },
      { label: 'Share Links', href: '/dashboard/share-links', icon: Link2 },
      { label: 'Reports', href: '/dashboard/reports', icon: FileBarChart },
      { label: 'Licence Expiry', href: '/dashboard/reports/licence-expiry', icon: Shield },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications', icon: Bell },
      { label: 'Delivery Dashboard', href: '/dashboard/notifications/deliveries', icon: Send },
      { label: 'Email History', href: '/dashboard/notifications/history', icon: Mail },
      { label: 'Offline Drafts', href: '/dashboard/offline', icon: Database },
      { label: 'Audit Log', href: '/dashboard/audit', icon: FileText },
      { label: 'Settings', href: '/dashboard/settings', icon: Settings },
      { label: 'User Management', href: '/dashboard/admin/users', icon: Users },
      { label: 'Roles & Permissions', href: '/dashboard/admin/roles', icon: Shield },
      { label: 'Workflow Routing', href: '/dashboard/admin/workflows', icon: GitBranch },
      { label: 'Regions', href: '/dashboard/admin/regions', icon: MapPin },
      { label: 'Tenants', href: '/dashboard/platform/tenants', icon: Globe },
      { label: 'Platform Dashboard', href: '/dashboard/platform', icon: LayoutDashboard },
      { label: 'Platform Audit', href: '/dashboard/platform/audit', icon: FileText },
      { label: 'Onboard Tenant', href: '/dashboard/platform/onboard', icon: LayoutDashboard },
    ],
  },
];

function roleAwareLabel(item: NavItem, roleNames: readonly string[]) {
  if (item.href === '/dashboard/requests') {
    if (roleNames.includes(SystemRoles.REQUESTER)) return 'My Requests';
    if (roleNames.includes(SystemRoles.TRANSPORT_ADMIN)) return 'Operational Requests';
  }
  if (item.href === '/dashboard/approvals') return 'Assigned Approvals';
  if (item.href === '/dashboard/trips' && roleNames.includes(SystemRoles.DRIVER)) {
    return 'Assigned Trips';
  }
  return item.label;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  roleNames: string[];
}

export function Sidebar({ collapsed, onToggle, roleNames }: SidebarProps) {
  const pathname = usePathname();
  const [activeTripCount, setActiveTripCount] = useState(0);

  useEffect(() => {
    if (!canNavigateDashboardPath('/dashboard/trips', roleNames)) return;
    fetch('/api/trips/attention')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.data?.total != null) setActiveTripCount(Number(d.data.total));
      })
      .catch(() => {
        /* silent */
      });
  }, [roleNames]);

  return (
    <aside
      className={cn(
        'border-border bg-surface fixed top-0 left-0 z-40 hidden h-dvh flex-col border-r transition-all duration-200 md:flex dark:bg-[#0f0f23]',
        collapsed ? 'w-[72px]' : 'w-[248px]',
      )}
    >
      {/* Fixed header: branding (collapse toggle moved to edge chevron) */}
      <div
        className={cn(
          'border-border flex shrink-0 items-center border-b px-4 dark:border-[#2a2a48]',
          collapsed ? 'h-16 justify-center' : 'h-16 gap-3',
        )}
      >
        <div className="bg-brand-800 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white">
          G
        </div>
        {!collapsed && (
          <span className="text-ink-950 dark:text-ink-100 text-sm font-semibold">
            {APP_SHORT_NAME}
          </span>
        )}
      </div>

      {/* Edge collapse chevron — vertically centred on the sidebar's right border,
          overlapping the divider, fixed while the nav scrolls. Desktop only;
          mobile uses the drawer. */}
      <button
        onClick={onToggle}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className="bg-surface border-border text-ink-500 hover:bg-muted hover:text-ink-800 dark:bg-[#1b1b39] dark:text-ink-300 dark:hover:bg-white/[0.08] dark:hover:text-ink-100 absolute top-1/2 right-0 z-20 hidden h-7 w-7 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 active:scale-95 md:flex"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      {/* Scrollable navigation area */}
      <nav
        className="scrollbar-thumb-border flex-1 scrollbar-thin scrollbar-track-transparent overflow-y-auto px-2 py-4"
        style={{ overscrollBehavior: 'contain' }}
      >
        {navGroups
          .map((group) => ({
            ...group,
            items: group.items.filter((item) => canNavigateDashboardPath(item.href, roleNames)),
          }))
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.label} className="mb-4">
              {!collapsed && (
                <p className="text-ink-400 dark:text-ink-500 mb-1 px-2 text-[11px] font-medium tracking-widest uppercase">
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
                            ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-600'
                            : 'text-ink-700 hover:bg-muted dark:text-ink-400 dark:hover:bg-white/[0.06]',
                          collapsed && 'justify-center px-0',
                        )}
                        title={collapsed ? item.label : undefined}
                      >
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0',
                            isActive
                              ? 'text-brand-700 dark:text-brand-600'
                              : 'text-ink-400 dark:text-ink-500',
                          )}
                        />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">
                              {roleAwareLabel(item, roleNames)}
                            </span>
                            {item.badge !== undefined &&
                              item.label === 'Trips' &&
                              activeTripCount > 0 && (
                                <span
                                  className="bg-status-error-text flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
                                  title={`${activeTripCount} trip${activeTripCount === 1 ? '' : 's'} require your attention`}
                                >
                                  {activeTripCount > 99 ? '99+' : activeTripCount}
                                </span>
                              )}
                            {item.badge !== undefined && item.label !== 'Trips' && (
                              <span className="bg-brand-600 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium text-white">
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
 * Mobile sidebar as a slide-over drawer with proper portal behaviour.
 */
export function MobileSidebar({
  open,
  onClose,
  roleNames,
}: {
  open: boolean;
  onClose: () => void;
  roleNames: string[];
}) {
  const pathname = usePathname();

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <aside
        className={cn(
          'border-border bg-surface fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r transition-transform duration-200 ease-out md:hidden dark:border-[#2a2a48] dark:bg-[#0f0f23]',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Header */}
        <div className="border-border flex h-16 shrink-0 items-center gap-3 border-b px-4 dark:border-[#2a2a48]">
          <div className="bg-brand-800 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">
            G
          </div>
          <span className="text-ink-950 dark:text-ink-100 text-sm font-semibold">
            {APP_SHORT_NAME}
          </span>
          <button
            onClick={onClose}
            className="text-ink-400 hover:bg-muted hover:text-ink-700 dark:hover:text-ink-200 ml-auto flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors dark:hover:bg-white/[0.06]"
            aria-label="Close navigation"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav
          className="pb-safe flex-1 overflow-y-auto px-2 py-4"
          style={{ overscrollBehavior: 'contain' }}
        >
          {navGroups
            .filter((group) =>
              group.items.some((item) => canNavigateDashboardPath(item.href, roleNames)),
            )
            .map((group) => (
              <div key={group.label} className="mb-4">
                <p className="text-ink-400 dark:text-ink-500 mb-1 px-2 text-[11px] font-medium tracking-widest uppercase">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items
                    .filter((item) => canNavigateDashboardPath(item.href, roleNames))
                    .map((item) => {
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
                                ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-600'
                                : 'text-ink-700 hover:bg-muted dark:text-ink-400 dark:hover:bg-white/[0.06]',
                            )}
                          >
                            <Icon
                              className={cn(
                                'h-[18px] w-[18px] shrink-0',
                                isActive
                                  ? 'text-brand-700 dark:text-brand-600'
                                  : 'text-ink-400 dark:text-ink-500',
                              )}
                            />
                            <span className="flex-1 truncate">
                              {roleAwareLabel(item, roleNames)}
                            </span>
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
