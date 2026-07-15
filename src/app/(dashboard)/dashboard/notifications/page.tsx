'use client';

import { useState, useCallback, useEffect } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Bell,
  BellOff,
  CheckCheck,
  Clock,
  AlertTriangle,
  Info,
  FileText,
  Truck,
  Gauge,
  Fuel,
  Wrench,
  CheckCircle2,
  Settings,
  AlertCircle,
  ChevronRight,
  Inbox,
  Wifi,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';

type NotificationType = 'all' | 'action_required' | 'awareness' | 'reminder' | 'escalation' | 'outcome';
type NotificationFilter = 'all' | 'unread' | 'read';

interface Notification {
  id: string;
  type: 'action_required' | 'awareness' | 'reminder' | 'escalation' | 'outcome';
  title: string;
  body: string;
  time: string;
  isRead: boolean;
  priority: 'high' | 'normal' | 'low';
  entityType: string;
  actionUrl: string;
}

// Fallback mock notifications when DB not connected
const mockNotifications: Notification[] = [
  { id: '1', type: 'action_required', title: 'Approval Required', body: 'Transport request TR-2026-0142 (Field inspection — Divundu) requires your approval.', time: '2 hours ago', isRead: false, priority: 'high', entityType: 'request', actionUrl: '/dashboard/approvals' },
  { id: '2', type: 'reminder', title: 'Trip Return Due Today', body: 'Vehicle GRN-005 (TRIP-2026-0092) is due for return. Return inspection must be completed.', time: '3 hours ago', isRead: false, priority: 'high', entityType: 'trip', actionUrl: '/dashboard/trips' },
  { id: '3', type: 'escalation', title: 'Escalated: Approval Overdue', body: 'Transport request TR-2026-0139 has been escalated to Chief Regional Officer. Action overdue by 6 hours.', time: '5 hours ago', isRead: false, priority: 'high', entityType: 'request', actionUrl: '/dashboard/approvals' },
  { id: '4', type: 'awareness', title: 'Vehicle Status Update', body: 'GRN-020 has been marked as Out of Service due to critical engine fault.', time: '8 hours ago', isRead: false, priority: 'normal', entityType: 'vehicle', actionUrl: '/dashboard/fleet' },
  { id: '5', type: 'outcome', title: 'Request Approved', body: 'Transport request TR-2026-0141 (Workshop materials — Rundu) has been approved by E. Hausiku.', time: '1 day ago', isRead: true, priority: 'normal', entityType: 'request', actionUrl: '/dashboard/requests' },
  { id: '6', type: 'action_required', title: 'Fuel Verification Needed', body: 'Fuel transaction #FT-2026-0452 requires verification. Fuel amount exceeds typical range.', time: '1 day ago', isRead: true, priority: 'normal', entityType: 'fuel', actionUrl: '/dashboard/fuel' },
  { id: '7', type: 'awareness', title: 'Maintenance Scheduled', body: 'GRN-012 is scheduled for 15,000 km service on 18 Jul 2026 at Rundu Gvt Garage.', time: '2 days ago', isRead: true, priority: 'normal', entityType: 'maintenance', actionUrl: '/dashboard/maintenance' },
  { id: '8', type: 'outcome', title: 'Trip Closed', body: 'TRIP-2026-0089 (Community outreach — Nkurenkuru) has been closed. All items accounted for.', time: '2 days ago', isRead: true, priority: 'low', entityType: 'trip', actionUrl: '/dashboard/trips' },
  { id: '9', type: 'reminder', title: 'Licence Expiry Reminder', body: 'Driver licence for T. Sikongo (Class B) expires in 14 days. Renewal required.', time: '3 days ago', isRead: true, priority: 'normal', entityType: 'staff', actionUrl: '/dashboard/staff' },
  { id: '10', type: 'awareness', title: 'Office Update', body: 'New settlement office registered at Shamvura. Contact details pending verification.', time: '4 days ago', isRead: true, priority: 'low', entityType: 'office', actionUrl: '/dashboard/offices' },
];

const typeColors: Record<NotificationType, { bg: string; text: string; icon: React.ReactNode }> = {
  all: { bg: 'bg-muted', text: 'text-ink-500', icon: <Inbox className="h-4 w-4" /> },
  action_required: { bg: 'bg-blue-50', text: 'text-blue-700', icon: <AlertCircle className="h-4 w-4" /> },
  awareness: { bg: 'bg-amber-50', text: 'text-amber-700', icon: <Info className="h-4 w-4" /> },
  reminder: { bg: 'bg-purple-50', text: 'text-purple-700', icon: <Clock className="h-4 w-4" /> },
  escalation: { bg: 'bg-red-50', text: 'text-red-700', icon: <AlertTriangle className="h-4 w-4" /> },
  outcome: { bg: 'bg-green-50', text: 'text-green-700', icon: <CheckCircle2 className="h-4 w-4" /> },
};

const typeLabels: Record<NotificationType, string> = {
  all: 'All',
  action_required: 'Action Required',
  awareness: 'Awareness',
  reminder: 'Reminder',
  escalation: 'Escalation',
  outcome: 'Outcome',
};

const entityIcons: Record<string, React.ReactNode> = {
  request: <FileText className="h-3.5 w-3.5" />,
  trip: <Gauge className="h-3.5 w-3.5" />,
  vehicle: <Truck className="h-3.5 w-3.5" />,
  fuel: <Fuel className="h-3.5 w-3.5" />,
  maintenance: <Wrench className="h-3.5 w-3.5" />,
  staff: <Bell className="h-3.5 w-3.5" />,
  office: <Bell className="h-3.5 w-3.5" />,
};

export default function NotificationsPage() {
  const { data: session } = useSession();
  const [selectedType, setSelectedType] = useState<NotificationType>('all');
  const [filterMode, setFilterMode] = useState<NotificationFilter>('all');
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const [isLive, setIsLive] = useState(false);

  // Attempt to fetch live notifications on mount
  useEffect(() => {
    const uid = session?.user?.id || 'system';
    fetch(`/api/notifications?userId=${uid}&limit=50`)
      .then((res) => res.ok ? res.json() : null)
      .then((json) => {
        if (!json?.success || !json?.data) return;
        const apiNotifs = (json.data.notifications || []).map((n: Record<string, string | boolean>) => ({
          id: n.id as string,
          type: (n.type as Notification['type']) || 'awareness',
          title: n.title as string || 'Notification',
          body: n.body as string || '',
          time: n.createdAt ? new Date(n.createdAt as string).toLocaleDateString('en-NA', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recently',
          isRead: Boolean(n.isRead),
          priority: (n.priority as Notification['priority']) || 'normal',
          entityType: (n.entityType as string) || 'request',
          actionUrl: (n.actionUrl as string) || '/dashboard',
        }));
        if (apiNotifs.length > 0) {
          setNotifications(apiNotifs);
          setIsLive(true);
        }
      })
      .catch(() => { /* Keep mock data */ });
  }, [session?.user?.id]);

  const filtered = notifications.filter((n) => {
    const typeMatch = selectedType === 'all' || n.type === selectedType;
    const readMatch =
      filterMode === 'all' ||
      (filterMode === 'unread' && !n.isRead) ||
      (filterMode === 'read' && n.isRead);
    return typeMatch && readMatch;
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAllRead = useCallback(async () => {
    const userId = session?.user?.id || 'system';
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read', userId }),
      });
    } catch {
      console.log('Mark all read - offline');
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, [session?.user?.id]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Notifications' },
      ]} />
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`}
      >
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            isLive ? 'bg-status-success-bg text-status-success-text' : 'bg-muted text-ink-500'
          }`}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isLive ? 'Live Data' : 'Sample Data'}
          </div>
          <Button variant="secondary" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="h-4 w-4" />
            Mark All Read
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/settings">
              <Settings className="h-4 w-4" />
              Preferences
            </Link>
          </Button>
        </div>
      </PageHeader>

      {/* Filter Bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(typeLabels) as [NotificationType, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setSelectedType(value)}
                  className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedType === value
                      ? 'bg-brand-800 text-white'
                      : 'text-ink-500 hover:text-ink-700 hover:bg-muted'
                  }`}
                >
                  {typeColors[value].icon}
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-[8px] border border-border p-0.5">
              {(['all', 'unread', 'read'] as NotificationFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterMode(f)}
                  className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${
                    filterMode === f
                      ? 'bg-brand-800 text-white'
                      : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification List */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No notifications"
          description={
            filterMode === 'unread'
              ? 'You have no unread notifications. Great job staying on top of things!'
              : 'No notifications match your current filters.'
          }
          icon={filterMode === 'unread' ? <BellOff className="h-6 w-6" /> : <Bell className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((notification) => {
            const colors = typeColors[notification.type];
            return (
              <Card
                key={notification.id}
                hover
                className={!notification.isRead ? 'border-brand-200 bg-brand-50/30' : ''}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        !notification.isRead ? colors.bg : 'bg-muted'
                      } ${!notification.isRead ? colors.text : 'text-ink-500'}`}
                    >
                      {colors.icon}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p
                              className={`text-sm ${
                                !notification.isRead
                                  ? 'font-semibold text-ink-950'
                                  : 'font-medium text-ink-700'
                              }`}
                            >
                              {notification.title}
                            </p>
                            {!notification.isRead && (
                              <span className="h-2 w-2 rounded-full bg-brand-600 shrink-0" />
                            )}
                            {notification.priority === 'high' && (
                              <Badge variant="pending" size="sm">High</Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-sm text-ink-500">{notification.body}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <span className="text-xs text-ink-400">{notification.time}</span>
                            <Badge variant="default" size="sm" className="gap-1">
                              {entityIcons[notification.entityType] || <Bell className="h-3 w-3" />}
                              {typeLabels[notification.type]}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Link
                      href={notification.actionUrl}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-muted hover:text-ink-700 transition-colors"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
