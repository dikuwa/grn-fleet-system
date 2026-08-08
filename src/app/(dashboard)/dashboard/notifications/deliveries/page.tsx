'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { StyledSelect } from '@/components/ui/styled-select';
import { EmptyState } from '@/components/ui/empty-state';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { fetchWithRetry } from '@/lib/fetch-with-retry';
import { useToast } from '@/lib/use-toast';
import {
  Mail,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Loader2,
  Smartphone,
  Bell,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';

interface DeliveryRecord {
  id: string;
  channel: string;
  providerId: string | null;
  attempt: number;
  status: string;
  errorSummary: string | null;
  createdAt: string;
  notificationId: string;
  notifType: string;
  notifTitle: string;
  notifBody: string | null;
  entityType: string | null;
}

interface DeliveryMetrics {
  total: number;
  email: number;
  sms: number;
  inApp: number;
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-NA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}

function getStatusVariant(status: string): 'success' | 'error' | 'pending' | 'info' {
  if (['sent', 'delivered'].includes(status)) return 'success';
  if (status === 'failed') return 'error';
  if (status === 'pending') return 'pending';
  return 'info';
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === 'email') return <Mail className="h-3.5 w-3.5" aria-hidden="true" />;
  if (channel === 'sms') return <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />;
  if (channel === 'in_app') return <Bell className="h-3.5 w-3.5" aria-hidden="true" />;
  return <Send className="h-3.5 w-3.5" aria-hidden="true" />;
}

function getChannelLabel(channel: string): string {
  return channel === 'in_app' ? 'In-App' : channel.charAt(0).toUpperCase() + channel.slice(1);
}

export default function DeliveryDashboardPage() {
  const { toast } = useToast();
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [metrics, setMetrics] = useState<DeliveryMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (channelFilter) params.set('channel', channelFilter);

      const res = await fetchWithRetry(`/api/notifications/deliveries?${params.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Failed to load delivery data');
      setDeliveries(json?.data?.deliveries ?? []);
      setMetrics(json?.data?.metrics ?? null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, channelFilter]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [fetchData]);

  const handleRetry = useCallback(async (deliveryId: string) => {
    setRetryingId(deliveryId);
    try {
      const res = await fetch(`/api/notifications/deliveries/${deliveryId}/retry`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Retry failed');
      toast({
        title: 'Delivery retry queued',
        description: 'The new attempt has been recorded and the delivery register was refreshed.',
        variant: 'success',
      });
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      setError(message);
      toast({ title: 'Retry failed', description: message, variant: 'error' });
    } finally {
      setRetryingId(null);
    }
  }, [fetchData, toast]);

  const summary = [
    { label: 'Total deliveries', value: metrics?.total ?? 0, detail: 'All channels', icon: Send, tone: 'text-brand-700 dark:text-brand-300' },
    { label: 'Sent', value: metrics?.sent ?? 0, detail: `${metrics?.email ?? 0} email · ${metrics?.sms ?? 0} SMS · ${metrics?.inApp ?? 0} in-app`, icon: CheckCircle2, tone: 'text-status-success-text' },
    { label: 'Failed', value: metrics?.failed ?? 0, detail: metrics?.failed ? 'Requires attention' : 'All clear', icon: XCircle, tone: 'text-status-error-text' },
    { label: 'Pending / skipped', value: (metrics?.pending ?? 0) + (metrics?.skipped ?? 0), detail: `${metrics?.pending ?? 0} pending · ${metrics?.skipped ?? 0} skipped`, icon: Clock, tone: 'text-status-warning-text' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Notifications', href: '/dashboard/notifications' },
        { label: 'Delivery Dashboard' },
      ]} />
      <PageHeader title="Delivery Dashboard" description="Monitor tenant notification delivery health and retry failed attempts.">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void fetchData()} loading={isLoading}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/notifications/history"><Mail className="h-4 w-4" aria-hidden="true" /> Email History</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/reports/licence-expiry"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Licence Expiry</Link>
          </Button>
        </div>
      </PageHeader>

      <section aria-label="Delivery summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map(({ label, value, detail, icon: Icon, tone }) => (
          <div key={label} className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
                <p className="mt-1 text-sm font-medium text-ink-800">{label}</p>
                <p className="mt-1 text-xs text-ink-400">{detail}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-muted text-ink-500">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-[220px_220px_auto] lg:items-center" aria-label="Delivery filters">
        <StyledSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter deliveries by status">
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="skipped">Skipped</option>
        </StyledSelect>
        <StyledSelect value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} aria-label="Filter deliveries by channel">
          <option value="">All channels</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="in_app">In-App</option>
        </StyledSelect>
        <ClientFilterReset
          isFiltered={Boolean(statusFilter || channelFilter)}
          onClear={() => { setStatusFilter(''); setChannelFilter(''); }}
        />
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-[8px] border border-status-error-border bg-status-error-bg px-4 py-3 text-sm text-status-error-text" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="flex-1">{error}</p>
          <Button variant="secondary" size="compact" onClick={() => void fetchData()}><RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry</Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading delivery records…
        </div>
      ) : !error && deliveries.length === 0 ? (
        <EmptyState
          icon={<Send className="h-6 w-6" />}
          title="No delivery records"
          description={statusFilter || channelFilter ? 'No delivery records match the current filters.' : 'Delivery records will appear when tenant notifications are sent.'}
        />
      ) : deliveries.length > 0 ? (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {deliveries.map((delivery) => (
            <article key={delivery.id} className="grid gap-4 border-b border-border px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={getStatusVariant(delivery.status)} label={delivery.status.charAt(0).toUpperCase() + delivery.status.slice(1)} />
                  <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-muted px-2 py-1 text-xs font-medium text-ink-600">
                    <ChannelIcon channel={delivery.channel} /> {getChannelLabel(delivery.channel)}
                  </span>
                  <span className="text-xs text-ink-400">Attempt #{delivery.attempt}</span>
                </div>
                <h2 className="mt-2 text-sm font-semibold text-ink-950">{delivery.notifTitle}</h2>
                {delivery.notifBody && <p className="mt-1 line-clamp-2 text-sm text-ink-500">{delivery.notifBody}</p>}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-400">
                  <time>{formatDate(delivery.createdAt)}</time>
                  {delivery.entityType && <span className="capitalize">{delivery.entityType.replaceAll('_', ' ')}</span>}
                  {delivery.providerId && <span className="font-mono">Provider {delivery.providerId.slice(0, 18)}{delivery.providerId.length > 18 ? '…' : ''}</span>}
                </div>
                {delivery.errorSummary && <p className="mt-2 text-xs text-status-error-text">{delivery.errorSummary}</p>}
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {delivery.status === 'failed' && (
                  <Button variant="secondary" size="sm" onClick={() => void handleRetry(delivery.id)} loading={retryingId === delivery.id} disabled={retryingId !== null}>
                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry delivery
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
