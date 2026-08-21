'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Fuel,
  Gauge,
  Inbox,
  Info,
  Mail,
  Save,
  Settings,
  Trash2,
  Truck,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';

type NotificationType =
  'all' | 'action_required' | 'awareness' | 'reminder' | 'escalation' | 'outcome';
type NotificationFilter = 'all' | 'unread' | 'read';
type NotificationPriority = 'emergency' | 'high' | 'normal' | 'low';

interface Notification {
  id: string;
  type: Exclude<NotificationType, 'all'>;
  title: string;
  body: string;
  time: string;
  isRead: boolean;
  priority: NotificationPriority;
  entityType: string;
  actionUrl: string | null;
  status: string;
  mandatory: boolean;
}

const typePresentation: Record<
  NotificationType,
  { icon: React.ReactNode; variant: 'default' | 'info' | 'warning' | 'error' | 'success' }
> = {
  all: { icon: <Inbox className="h-4 w-4" />, variant: 'default' },
  action_required: { icon: <AlertCircle className="h-4 w-4" />, variant: 'info' },
  awareness: { icon: <Info className="h-4 w-4" />, variant: 'warning' },
  reminder: { icon: <Clock className="h-4 w-4" />, variant: 'info' },
  escalation: { icon: <AlertTriangle className="h-4 w-4" />, variant: 'error' },
  outcome: { icon: <CheckCircle2 className="h-4 w-4" />, variant: 'success' },
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

const notificationTone = (type: Notification['type']) => {
  if (type === 'escalation') return 'bg-status-error-bg text-status-error-text';
  if (type === 'awareness') return 'bg-status-warning-bg text-status-warning-text';
  if (type === 'outcome') return 'bg-status-success-bg text-status-success-text';
  if (type === 'action_required') return 'bg-status-info-bg text-status-info-text';
  return 'bg-muted text-ink-600';
};

function normalizePriority(priority: string): NotificationPriority {
  if (
    priority === 'emergency' ||
    priority === 'high' ||
    priority === 'normal' ||
    priority === 'low'
  ) {
    return priority;
  }
  // Older callers used "urgent" for the same top-priority safety state. Treat
  // it as emergency so existing records retain their intended prominence.
  if (priority === 'urgent') return 'emergency';
  return 'normal';
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useNotificationBroadcast();
  const [selectedType, setSelectedType] = useState<NotificationType>('all');
  const [filterMode, setFilterMode] = useState<NotificationFilter>('all');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [quietHoursStart, setQuietHoursStart] = useState('20:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);

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
    () =>
      (notificationQuery.data?.notifications || []).map((notification) => ({
        id: notification.id,
        type: typeLabels[notification.type as NotificationType]
          ? (notification.type as Notification['type'])
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
        priority: normalizePriority(notification.priority),
        entityType: notification.entityType || 'request',
        actionUrl: notification.actionUrl,
        status: notification.status,
        mandatory: notification.mandatory,
      })),
    [notificationQuery.data],
  );

  const filtered = useMemo(
    () =>
      notifications
        .filter((notification) => {
          const typeMatch = selectedType === 'all' || notification.type === selectedType;
          const readMatch =
            filterMode === 'all' ||
            (filterMode === 'unread' && !notification.isRead) ||
            (filterMode === 'read' && notification.isRead);
          return typeMatch && readMatch;
        })
        .sort((a, b) => {
          const typeRank: Record<Notification['type'], number> = {
            action_required: 0,
            escalation: 1,
            reminder: 2,
            outcome: 3,
            awareness: 4,
          };
          const priorityRank: Record<NotificationPriority, number> = {
            emergency: 0,
            high: 1,
            normal: 2,
            low: 3,
          };
          return (
            typeRank[a.type] - typeRank[b.type] ||
            priorityRank[a.priority] - priorityRank[b.priority] ||
            Number(a.isRead) - Number(b.isRead)
          );
        }),
    [filterMode, notifications, selectedType],
  );

  const unreadCount = notificationQuery.data?.unreadCount || 0;

  useEffect(() => {
    const preferences = notificationQuery.data?.preferences;
    if (!preferences) return;
    const timer = window.setTimeout(() => {
      setEmailNotifications(preferences.emailNotifications);
      setInAppNotifications(preferences.inAppNotifications);
      setQuietHoursStart(preferences.quietHoursStart || '20:00');
      setQuietHoursEnd(preferences.quietHoursEnd || '07:00');
    }, 0);
    return () => window.clearTimeout(timer);
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
      toast({
        title: 'Preferences saved',
        description: 'Notification delivery settings have been updated.',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Could not save preferences',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    } finally {
      setSavingPreferences(false);
    }
  }, [emailNotifications, inAppNotifications, queryClient, quietHoursEnd, quietHoursStart, toast]);

  const markAllRead = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read' }),
      });
      if (!response.ok) throw new Error('Unable to mark notifications as read');
      await queryClient.invalidateQueries({ queryKey: notificationQueryKey });
      broadcastNotificationChange();
      toast({
        title: 'Notifications updated',
        description: 'All visible notifications are marked as read.',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'error',
      });
    }
  }, [queryClient, toast]);

  const markOneRead = useCallback(
    (notificationId: string) => {
      queryClient.setQueryData<NotificationFeed>(notificationQueryKey, (current) => {
        if (!current) return current;
        const wasUnread = current.notifications.some(
          (notification) => notification.id === notificationId && !notification.isRead,
        );
        const target = current.notifications.find(
          (notification) => notification.id === notificationId,
        );
        const remainsRequired = target?.status === 'action_required';
        return {
          ...current,
          notifications: current.notifications.map((notification) =>
            notification.id === notificationId ? { ...notification, isRead: true } : notification,
          ),
          unreadCount: wasUnread ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
          attentionCount:
            wasUnread && !remainsRequired
              ? Math.max(0, current.attentionCount - 1)
              : current.attentionCount,
        };
      });
      void fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read', notificationId }),
        keepalive: true,
      }).then((response) => {
        if (!response.ok) void queryClient.invalidateQueries({ queryKey: notificationQueryKey });
        broadcastNotificationChange();
      });
    },
    [queryClient],
  );

  const deleteOne = useCallback(
    async (notificationId: string) => {
      const response = await fetch(`/api/notifications?id=${encodeURIComponent(notificationId)}`, {
        method: 'DELETE',
        keepalive: true,
      });
      if (!response.ok) {
        await queryClient.invalidateQueries({ queryKey: notificationQueryKey });
        throw new Error('Unable to dismiss notification');
      }
      queryClient.setQueryData<NotificationFeed>(notificationQueryKey, (current) => {
        if (!current) return current;
        const removed = current.notifications.find(
          (notification) => notification.id === notificationId,
        );
        const required = removed?.status === 'action_required';
        return {
          ...current,
          notifications: current.notifications.filter(
            (notification) => notification.id !== notificationId,
          ),
          unreadCount:
            removed && !removed.isRead ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
          actionRequiredCount: required
            ? Math.max(0, current.actionRequiredCount - 1)
            : current.actionRequiredCount,
          attentionCount:
            removed && (!removed.isRead || required)
              ? Math.max(0, current.attentionCount - 1)
              : current.attentionCount,
        };
      });
      broadcastNotificationChange();
      toast({ title: 'Notification dismissed', variant: 'success' });
    },
    [queryClient, toast],
  );

  const clearAll = useCallback(async () => {
    const response = await fetch('/api/notifications', { method: 'DELETE', keepalive: true });
    await queryClient.invalidateQueries({ queryKey: notificationQueryKey });
    if (!response.ok) throw new Error('Unable to clear notifications');
    broadcastNotificationChange();
    toast({
      title: 'Notifications cleared',
      description: 'Required unresolved actions were preserved.',
      variant: 'success',
    });
  }, [queryClient, toast]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Notifications' }]}
      />
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
      >
        <span
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium ${notificationQuery.isError ? 'bg-status-error-bg text-status-error-text' : 'bg-status-success-bg text-status-success-text'}`}
        >
          {notificationQuery.isError ? (
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {notificationQuery.isError ? 'Connection error' : 'Live'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void markAllRead()}
          disabled={unreadCount === 0}
        >
          <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark All Read
        </Button>
        {notifications.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setClearAllConfirm(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear All
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => setPreferencesOpen(true)}>
          <Settings className="h-4 w-4" aria-hidden="true" /> Preferences
        </Button>
      </PageHeader>

      <div className="border-border space-y-3 border-y py-4">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Notification type">
          {(Object.entries(typeLabels) as [NotificationType, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={selectedType === value}
              onClick={() => setSelectedType(value)}
              className={`focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-[7px] px-3 text-xs font-medium transition-colors motion-reduce:transition-none ${selectedType === value ? 'bg-brand-800 text-white' : 'text-ink-500 hover:bg-muted hover:text-ink-800'}`}
            >
              {typePresentation[value].icon}
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Read status">
          {(['all', 'unread', 'read'] as NotificationFilter[]).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setFilterMode(filter)}
              aria-pressed={filterMode === filter}
              className={`focus-ring min-h-8 rounded-[7px] px-2.5 text-xs font-medium transition-colors motion-reduce:transition-none ${filterMode === filter ? 'bg-muted text-ink-950' : 'text-ink-500 hover:text-ink-800'}`}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {notificationQuery.isLoading ? (
        <div className="text-ink-500 py-12 text-center text-sm">Loading notifications…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No notifications"
          description={
            filterMode === 'unread'
              ? 'There are no unread notifications in this view.'
              : 'No notifications match your current filters.'
          }
          icon={
            filterMode === 'unread' ? <BellOff className="h-6 w-6" /> : <Bell className="h-6 w-6" />
          }
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {filtered.map((notification) => (
            <article
              key={notification.id}
              className={`border-border border-b px-4 py-4 last:border-b-0 sm:px-5 ${!notification.isRead ? 'bg-brand-50/30 dark:bg-brand-950/15' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] ${notification.isRead ? 'bg-muted text-ink-500' : notificationTone(notification.type)}`}
                  aria-hidden="true"
                >
                  {typePresentation[notification.type].icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      className={`text-sm ${notification.isRead ? 'text-ink-800 font-medium' : 'text-ink-950 font-semibold'}`}
                    >
                      {notification.title}
                    </h2>
                    {!notification.isRead && (
                      <span className="bg-brand-600 h-2 w-2 rounded-full" aria-label="Unread" />
                    )}
                    {notification.priority === 'emergency' && (
                      <Badge variant="error" size="sm">
                        Emergency
                      </Badge>
                    )}
                    {notification.priority === 'high' && (
                      <Badge variant="warning" size="sm">
                        High priority
                      </Badge>
                    )}
                  </div>
                  <p className="text-ink-600 mt-1 text-sm leading-relaxed">{notification.body}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-ink-400 text-xs">{notification.time}</span>
                    <Badge
                      variant={typePresentation[notification.type].variant}
                      size="sm"
                      className="gap-1"
                    >
                      {entityIcons[notification.entityType] || <Bell className="h-3 w-3" />}
                      {typeLabels[notification.type]}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {notification.actionUrl && (
                    <Button variant="secondary" size="sm" asChild>
                      <Link
                        href={notification.actionUrl}
                        onClick={() => markOneRead(notification.id)}
                      >
                        Review <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </Button>
                  )}
                  {!notification.isRead && (
                    <button
                      type="button"
                      onClick={() => markOneRead(notification.id)}
                      className="focus-ring text-ink-400 hover:bg-muted hover:text-ink-800 flex h-9 w-9 items-center justify-center rounded-[8px]"
                      aria-label={`Mark ${notification.title} as read`}
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  {!(notification.mandatory && notification.status === 'action_required') && (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(notification.id)}
                      className="focus-ring text-ink-400 hover:bg-status-error-bg hover:text-status-error-text flex h-9 w-9 items-center justify-center rounded-[8px]"
                      aria-label={`Dismiss ${notification.title}`}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Dismiss notification"
          description="This informational notification will be dismissed from your list."
          confirmLabel="Dismiss"
          cancelLabel="Cancel"
          variant="destructive"
          onConfirm={async () => {
            if (!deleteTarget) return;
            await deleteOne(deleteTarget);
            setDeleteTarget(null);
          }}
        />
      )}

      <ConfirmDialog
        open={clearAllConfirm}
        onOpenChange={setClearAllConfirm}
        title="Clear all notifications"
        description="Informational notifications will be dismissed. Unresolved required actions will remain."
        confirmLabel="Clear All"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={async () => {
          await clearAll();
          setClearAllConfirm(false);
        }}
      />

      <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Notification preferences</DialogTitle>
            <DialogDescription>
              Choose personal delivery channels and quiet hours.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="border-border flex cursor-pointer items-center justify-between gap-3 rounded-[8px] border p-3">
              <span className="text-ink-950 flex items-center gap-2 text-sm">
                <Bell className="h-4 w-4" aria-hidden="true" />
                In-app notifications
              </span>
              <Checkbox
                checked={inAppNotifications}
                onCheckedChange={(checked) => setInAppNotifications(checked === true)}
                aria-label="Enable in-app notifications"
              />
            </label>
            <label className="border-border flex cursor-pointer items-center justify-between gap-3 rounded-[8px] border p-3">
              <span className="text-ink-950 flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4" aria-hidden="true" />
                Email notifications
              </span>
              <Checkbox
                checked={emailNotifications}
                onCheckedChange={(checked) => setEmailNotifications(checked === true)}
                aria-label="Enable email notifications"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldWrapper label="Quiet hours start">
                <StyledDateInput
                  type="time"
                  value={quietHoursStart}
                  onChange={(event) => setQuietHoursStart(event.target.value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Quiet hours end">
                <StyledDateInput
                  type="time"
                  value={quietHoursEnd}
                  onChange={(event) => setQuietHoursEnd(event.target.value)}
                />
              </FieldWrapper>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPreferencesOpen(false)}>
              Cancel
            </Button>
            <Button loading={savingPreferences} onClick={() => void savePreferences()}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save preferences
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
