'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { APP_SHORT_NAME } from '@/lib/constants';
import { getWorkspaceNavigation, type WorkspaceId } from '@/lib/dashboard-access';
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
  UserCog,
  CalendarClock,
  Clock,
  Mail,
  Send,
  Database,
  Link2,
  GitBranch,
  AlertTriangle,
  FilePlus2,
  Menu,
  Package,
  MessageSquareText,
  CreditCard,
  MonitorPlay,
  PhoneCall,
  type LucideIcon,
} from 'lucide-react';

const iconRegistry: Record<string, LucideIcon> = {
  LayoutDashboard,
  FileText,
  FilePlus2,
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
  Globe,
  MapPin,
  Shield,
  BrainCircuit,
  Receipt,
  User,
  UserCog,
  CalendarClock,
  Clock,
  Mail,
  Send,
  Database,
  Link2,
  GitBranch,
  AlertTriangle,
  Package,
  MessageSquareText,
  CreditCard,
  MonitorPlay,
  PhoneCall,
};

function getNavGroups(activeWorkspace: WorkspaceId) {
  const navigation = getWorkspaceNavigation(activeWorkspace);

  if (activeWorkspace === 'platform_admin') {
    const root = navigation.find((item) => item.path === '/dashboard/platform');
    if (root) {
      const ensure = (
        path: string,
        id: string,
        label: string,
        icon: string,
        order: number,
        section = 'Platform',
      ) => {
        if (navigation.some((item) => item.path === path)) return;
        navigation.push({
          ...root,
          id,
          path,
          href: path,
          label,
          icon,
          order,
          section,
        });
      };

      // These are first-class Platform Admin tools. Keep them explicit rather
      // than deriving them from neighbouring routes so they remain visible even
      // if another platform route is permission-filtered or reordered later.
      ensure('/dashboard/platform/users', 'platform-users', 'Platform Users', 'UserCog', 505, 'Platform Access');
      ensure('/dashboard/platform/enquiries', 'platform-enquiries', 'Public Enquiries', 'MessageSquareText', 551);
      ensure('/dashboard/platform/packages', 'platform-packages', 'Subscription Packages', 'Package', 541);
    }
  }

  navigation.sort((a, b) => a.order - b.order);
  const groups = new Map<string, ReturnType<typeof getWorkspaceNavigation>>();
  for (const item of navigation) {
    const group = groups.get(item.section) ?? [];
    group.push(item);
    groups.set(item.section, group);
  }
  return Array.from(groups, ([label, items]) => ({ label, items }));
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeWorkspace: WorkspaceId;
  badgeCounts: Record<string, number>;
}

export function Sidebar({ collapsed, onToggle, activeWorkspace, badgeCounts }: SidebarProps) {
  const pathname = usePathname();
  const navGroups = getNavGroups(activeWorkspace);

  return (
    <aside
      className={cn(
        'border-border bg-surface fixed top-0 left-0 z-40 hidden h-dvh flex-col border-r transition-[width] duration-200 motion-reduce:transition-none md:flex',
        collapsed ? 'w-[72px]' : 'w-[248px]',
      )}
    >
      <div
        className={cn(
          'border-border relative flex h-16 shrink-0 items-center border-b',
          collapsed ? 'justify-center px-2' : 'gap-3 px-4',
        )}
      >
        <div className="bg-brand-800 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white">G</div>
        {!collapsed && <span className="text-ink-950 truncate text-sm font-semibold">{APP_SHORT_NAME}</span>}
        <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed} title={collapsed ? 'Expand navigation' : 'Collapse navigation'} className="border-border bg-surface text-ink-500 hover:bg-muted hover:text-ink-800 focus-visible:ring-brand-600 absolute top-1/2 -right-3 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors focus:outline-none focus-visible:ring-2 motion-reduce:transition-none">
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      <nav className="scrollbar-thumb-border flex-1 scrollbar-thin scrollbar-track-transparent overflow-y-auto px-2 py-4" style={{ overscrollBehavior: 'contain' }} aria-label="Workspace navigation">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && <p className="text-ink-400 mb-1 px-2 text-[11px] font-medium tracking-widest uppercase">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.path || pathname.startsWith(item.path + '/');
                const Icon = iconRegistry[item.icon ?? 'FileText'] ?? FileText;
                return (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={isActive ? 'page' : undefined} className={cn('focus-ring flex min-h-10 items-center gap-3 rounded-[8px] px-2 py-2 text-sm transition-colors motion-reduce:transition-none', isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300' : 'text-ink-700 hover:bg-muted hover:text-ink-950', collapsed && 'justify-center px-0')} title={collapsed ? item.label : undefined}>
                      <Icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-brand-700 dark:text-brand-300' : 'text-ink-400')} aria-hidden="true" />
                      {!collapsed && <><span className="flex-1 truncate">{item.label}</span>{item.badgeQuery && badgeCounts[item.badgeQuery] > 0 && <><span className="sr-only">{badgeCounts[item.badgeQuery]} item{badgeCounts[item.badgeQuery] === 1 ? '' : 's'} require your attention.</span><span aria-hidden="true" className="bg-status-error-text flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white">{badgeCounts[item.badgeQuery] > 99 ? '99+' : badgeCounts[item.badgeQuery]}</span></>}</>}
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

export function MobileSidebar({ open, onClose, activeWorkspace, tenantName, workspaceLabel }: { open: boolean; onClose: () => void; activeWorkspace: WorkspaceId; tenantName?: string; workspaceLabel?: string; }) {
  const pathname = usePathname();
  const navGroups = getNavGroups(activeWorkspace);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      window.setTimeout(() => drawerRef.current?.querySelector<HTMLElement>('button, a')?.focus(), 0);
    } else {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return <>
    {open && <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-md md:hidden" onClick={onClose} aria-hidden="true" />}
    <aside ref={drawerRef} hidden={!open} inert={!open} className={cn('border-border bg-surface pt-safe fixed inset-y-0 left-0 z-50 flex w-[min(88vw,320px)] flex-col border-r shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none md:hidden', open ? 'translate-x-0' : '-translate-x-full')} role="dialog" aria-modal="true" aria-label="Navigation menu" aria-hidden={!open}>
      <div className="border-border flex h-16 shrink-0 items-center gap-3 border-b px-4"><div className="bg-brand-800 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">G</div><span className="text-ink-950 text-sm font-semibold">{APP_SHORT_NAME}</span><button type="button" onClick={onClose} className="focus-ring text-ink-400 hover:bg-muted hover:text-ink-700 ml-auto flex h-11 w-11 items-center justify-center rounded-[8px] transition-colors motion-reduce:transition-none" aria-label="Close navigation"><ChevronLeft className="h-4 w-4" /></button></div>
      <div className="border-border border-b px-4 py-3">{tenantName && <p className="overflow-wrap-anywhere text-ink-950 text-sm font-medium">{tenantName}</p>}<p className="text-ink-500 mt-0.5 text-xs">{workspaceLabel ?? activeWorkspace.replaceAll('_', ' ')}</p></div>
      <nav className="pb-safe flex-1 overflow-y-auto px-2 py-4" style={{ overscrollBehavior: 'contain' }} aria-label="Full workspace navigation">
        {navGroups.map((group) => <div key={group.label} className="mb-4"><p className="text-ink-400 mb-1 px-2 text-[11px] font-medium tracking-widest uppercase">{group.label}</p><ul className="space-y-0.5">{group.items.map((item) => { const isActive = pathname === item.path || pathname.startsWith(item.path + '/'); const Icon = iconRegistry[item.icon ?? 'FileText'] ?? FileText; return <li key={item.href}><Link href={item.href} onClick={onClose} aria-current={isActive ? 'page' : undefined} className={cn('focus-ring flex min-h-11 items-center gap-3 rounded-[8px] px-3 py-2.5 text-sm transition-colors motion-reduce:transition-none', isActive ? 'bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-300' : 'text-ink-700 hover:bg-muted hover:text-ink-950')}><Icon className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-brand-700 dark:text-brand-300' : 'text-ink-400')} aria-hidden="true" /><span className="flex-1 truncate">{item.label}</span></Link></li>; })}</ul></div>)}
      </nav>
    </aside>
  </>;
}

export function MobileBottomNav({ activeWorkspace, onMore, badgeCounts }: { activeWorkspace: WorkspaceId; onMore: () => void; badgeCounts: Record<string, number>; }) {
  const pathname = usePathname();
  const navPaths = new Set(getWorkspaceNavigation(activeWorkspace).map((item) => item.path));
  const canNavigateTo = (path: string) => navPaths.has(path);
  const primary = activeWorkspace === 'driver'
    ? { href: '/dashboard/driver-mobile', label: 'Trips', icon: Gauge, badgeQuery: 'trips:assigned-attention' as const }
    : activeWorkspace === 'approver'
      ? { href: '/dashboard/approvals', label: 'Approvals', icon: ClipboardCheck, badgeQuery: 'approvals:assigned' as const }
      : activeWorkspace === 'personal'
        ? { href: '/dashboard/requests', label: 'Requests', icon: FileText, badgeQuery: 'requests:drafts' as const }
        : { href: '/dashboard/requests', label: 'Requests', icon: FileText };
  const items = [
    { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
    ...(canNavigateTo(primary.href) ? [primary] : []),
    ...(canNavigateTo('/dashboard/requests/new') ? [{ href: '/dashboard/requests/new', label: 'New', icon: FilePlus2 }] : []),
    { href: '/dashboard/notifications', label: 'Alerts', icon: Bell },
  ];

  return <nav aria-label="Quick navigation" className="mobile-bottom-nav border-border bg-surface/95 pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t px-1 backdrop-blur md:hidden print:hidden">
    {items.map((item) => { const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`)); const Icon = item.icon; const badgeCount = item.badgeQuery ? badgeCounts[item.badgeQuery] : 0; return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('focus-ring flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[8px] px-1 text-[11px] font-medium transition-colors motion-reduce:transition-none', active ? 'text-brand-700' : 'text-ink-500')}><span className="relative"><Icon className="h-5 w-5" aria-hidden="true" />{badgeCount > 0 && <span aria-hidden="true" className="bg-status-error-text absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white">{badgeCount > 99 ? '99+' : badgeCount}</span>}</span><span className="max-w-full truncate">{item.label}</span>{badgeCount > 0 && <span className="sr-only">{badgeCount} item{badgeCount === 1 ? '' : 's'} require your attention.</span>}</Link>; })}
    <button type="button" onClick={onMore} className="focus-ring text-ink-500 flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[8px] px-1 text-[11px] font-medium" aria-label="Open full navigation"><Menu className="h-5 w-5" aria-hidden="true" /><span>More</span></button>
  </nav>;
}
