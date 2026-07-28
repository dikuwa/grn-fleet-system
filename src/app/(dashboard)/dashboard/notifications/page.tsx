'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
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
  Mail,
  Save,
  AlertCircle,
  ChevronRight,
  Inbox,
  Wifi,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import {
  broadcastNotificationChange,
  fetchNotifications,
  notificationQueryKey,
  type NotificationFeed,
  useNotificationBroadcast,
} from '@/lib/notifications-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StyledDateInput } from '@/components/ui/styled-select';
import { FieldWrapper } from '@/components/ui/input';

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
  actionUrl: string | null;
}

const typeColors: Record<NotificationType, { bg: string; text: string; icon: React.ReactNode }> = {
  all: { bg: 'bg-muted', text: 'text-ink-500', icon: <Inbox className="h-4 w-4" /> },
  action_required: { bg: 'bg-blue-50 dark:bg-blue-950/50', text: 'text-blue-700 dark:text-blue-300', icon: <AlertCircle className="h-4 w-4" /> },
  awareness: { bg: 'bg-amber-50 dark:bg-amber-950/50', text: 'text-amber-700 dark:text-amber-300', icon: <Info className="h-4 w-4" /> },
  reminder: { bg: 'bg-purple-50 dark:bg-purple-950/50', text: 'text-purple-700 dark:text-purple-300', icon: <Clock className="h-4 w-4" /> },
  escalation: { bg: 'bg-red-50 dark:bg-red-950/50', text: 'text-red-700 dark:text-red-300', icon: <AlertTriangle className="h-4 w-4" /> },
  outcome: { bg: 'bg-green-50 dark:bg-green-950/50', text: 'text-green-700 dark:text-green-300', icon: <CheckCircle2 className="h-4 w-4" /> },
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
  const queryClient = useQueryClient();
  useNotificationBroadcast();
  const [selectedType, setSelectedType] = useState<NotificationType>('all');
  const [filterMode, setFilterMode] = useState<NotificationFilter>('all');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState('20:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const notificationQuery = useQuery({
    queryKey: notificationQueryKey,
    queryFn: ({ signal }) => fetchNotifications(signal),
    staleTime: 3_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const notifications = useMemo<Notification[]>(
    () => (notificationQuery.data?.notifications || []).map((notification) => ({
      id: notification.id,
      type: typeLabels[notification.type as NotificationType]
        ? notification.type as Notification['type']
        : 'awareness',
      title: notification.title || 'Notification',
      body: notification.body || '',
      time: new Date(notification.createdAt).toLocaleString('en-NA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      isRead: notification.isRead,
      priority: ['high', 'normal', 'low'].includes(notification.priority)
        ? notification.priority as Notification['priority']
        : 'normal',
      entityType: notification.entityType || 'request',
      actionUrl: notification.actionUrl,
    })),
    [notificationQuery.data],
  );

  const filtered = notifications.filter((n) => {
    const typeMatch = selectedType === 'all' || n.type === selectedType;
    const readMatch =
      filterMode === 'all' ||
      (filterMode === 'unread' && !n.isRead) ||
      (filterMode === 'read' && n.isRead);
    return typeMatch && readMatch;
  });

  const unreadCount = notificationQuery.data?.unreadCount || 0;
  useEffect(() => {
    const preferences = notificationQuery.data?.preferences;
    if (!preferences) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setEmailNotifications(preferences.emailNotifications);
      setInAppNotifications(preferences.inAppNotifications);
      setQuietHoursStart(preferences.quietHoursStart || '20:00');
      setQuietHoursEnd(preferences.quietHoursEnd || '07:00');
    });
    return () => {
      cancelled = true;
    };
  }, [notificationQuery.data?.preferences]);

  const savePreferences = useCallback(async () => {
    setSavingPreferences(true);
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_preferences',
          emailNotifications,
          inAppNotifications,
          quietHoursStart,
          quietHoursEnd,
        }),
      });
      if (!response.ok) throw new Error('Unable to save notification preferences');
      await queryClient.invalidateQueries({ queryKey: notificationQueryKey });
      setPreferencesOpen(false);
    } finally {
      setSavingPreferences(false);
    }
  }, [emailNotifications, inAppNotifications, queryClient, quietHoursEnd, quietHoursStart]);

  const markAllRead = useCallback(async () => {
    const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read' }),
      });
    if (!response.ok) throw new Error('Unable to mark notifications as read');
    await queryClient.invalidateQueries({ queryKey: notificationQueryKey });
    broadcastNotificationChange();
  }, [queryClient]);

  const markOneRead = useCallback((notificationId: string) => {
    queryClient.setQueryData<NotificationFeed>(notificationQueryKey, (current) => {
      if (!current) return current;
      const wasUnread = current.notifications.some(
        (notification) => notification.id === notificationId && !notification.isRead,
      );
      return {
        ...current,
        notifications: current.notifications.map((notification) => (
          notification.id === notificationId
            ? { ...notification, isRead: true }
            : notification
        )),
        unreadCount: wasUnread ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
      };
    });
    void fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_read', notificationId }),
      keepalive: true,
    }).then(() => broadcastNotificationChange());
  }, [queryClient]);

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
            notificationQuery.isError ? 'bg-status-error-bg text-status-error-text' : 'bg-status-success-bg text-status-success-text'
          }`}>
            {notificationQuery.isError ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
            {notificationQuery.isError ? 'Connection error' : 'Live'}
          </div>
          <Button variant="secondary" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="h-4 w-4" />
            Mark All Read
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPreferencesOpen(true)}>
            <Settings className="h-4 w-4" />
            Preferences
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

                    {notification.actionUrl && (
                      <Link
                        href={notification.actionUrl}
                        onClick={() => markOneRead(notification.id)}
                        aria-label={`Open ${notification.title}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-muted hover:text-ink-700 transition-colors"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Notification preferences</DialogTitle>
            <DialogDescription>Choose personal delivery channels and quiet hours.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex items-center justify-between rounded-[8px] border border-border p-3">
              <span className="flex items-center gap-2 text-sm text-ink-950"><Bell className="h-4 w-4" /> In-app notifications</span>
              <input type="checkbox" checked={inAppNotifications} onChange={(event) => setInAppNotifications(event.target.checked)} className="h-4 w-4 accent-brand-800" />
            </label>
            <label className="flex items-center justify-between rounded-[8px] border border-border p-3">
              <span className="flex items-center gap-2 text-sm text-ink-950"><Mail className="h-4 w-4" /> Email notifications</span>
              <input type="checkbox" checked={emailNotifications} onChange={(event) => setEmailNotifications(event.target.checked)} className="h-4 w-4 accent-brand-800" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldWrapper label="Quiet hours start">
                <StyledDateInput type="time" value={quietHoursStart} onChange={(event) => setQuietHoursStart(event.target.value)} />
              </FieldWrapper>
              <FieldWrapper label="Quiet hours end">
                <StyledDateInput type="time" value={quietHoursEnd} onChange={(event) => setQuietHoursEnd(event.target.value)} />
              </FieldWrapper>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPreferencesOpen(false)}>Cancel</Button>
            <Button loading={savingPreferences} onClick={savePreferences}><Save className="h-4 w-4" /> Save preferences</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
