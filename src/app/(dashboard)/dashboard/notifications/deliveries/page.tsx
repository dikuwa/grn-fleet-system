'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  Mail,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Loader2,
  Ban,
  Smartphone,
  Bell,
  AlertTriangle,
  Search,
} from 'lucide-react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-NA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

function getStatusVariant(status: string): 'success' | 'error' | 'pending' | 'info' {
  if (['sent', 'delivered'].includes(status)) return 'success';
  if (status === 'failed') return 'error';
  if (status === 'pending') return 'pending';
  return 'info';
}

function getChannelIcon(channel: string) {
  switch (channel) {
    case 'email': return <Mail className="h-3 w-3" />;
    case 'sms': return <Smartphone className="h-3 w-3" />;
    case 'in_app': return <Bell className="h-3 w-3" />;
    default: return <Send className="h-3 w-3" />;
  }
}

function getChannelLabel(channel: string): string {
  return channel === 'in_app' ? 'In-App' : channel.charAt(0).toUpperCase() + channel.slice(1);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DeliveryDashboardPage() {
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [metrics, setMetrics] = useState<DeliveryMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (channelFilter) params.set('channel', channelFilter);

      const res = await fetch(`/api/notifications/deliveries?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load delivery data');
      const json = await res.json();
      setDeliveries(json.data.deliveries ?? []);
      setMetrics(json.data.metrics ?? null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, channelFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRetry = useCallback(async (deliveryId: string) => {
    setRetryingId(deliveryId);
    try {
      const res = await fetch(`/api/notifications/deliveries/${deliveryId}/retry`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Retry failed');
      }
      // Refresh the data to show the retry attempt
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  }, [fetchData]);

  const statCards = [
    {
      title: 'Total Deliveries',
      value: String(metrics?.total ?? 0),
      description: 'All notification deliveries',
      icon: <Send className="h-5 w-5" />,
      color: 'text-ink-950',
    },
    {
      title: 'Sent',
      value: String(metrics?.sent ?? 0),
      description: `${metrics?.email ?? 0} email, ${metrics?.sms ?? 0} SMS, ${metrics?.inApp ?? 0} in-app`,
      icon: <CheckCircle2 className="h-5 w-5" />,
      color: 'text-status-success-text',
    },
    {
      title: 'Failed',
      value: String(metrics?.failed ?? 0),
      description: metrics && metrics.failed > 0 ? 'Requires attention' : 'All clear',
      icon: <XCircle className="h-5 w-5" />,
      color: 'text-status-error-text',
    },
    {
      title: 'Pending & Skipped',
      value: String((metrics?.pending ?? 0) + (metrics?.skipped ?? 0)),
      description: `${metrics?.pending ?? 0} pending, ${metrics?.skipped ?? 0} skipped`,
      icon: <Clock className="h-5 w-5" />,
      color: 'text-status-pending-text',
    },
  ];

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'sent', label: 'Sent' },
    { value: 'failed', label: 'Failed' },
    { value: 'pending', label: 'Pending' },
    { value: 'skipped', label: 'Skipped' },
  ];

  const channelOptions = [
    { value: '', label: 'All Channels' },
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'in_app', label: 'In-App' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Notifications', href: '/dashboard/notifications' },
        { label: 'Delivery Dashboard' },
      ]} />
      <PageHeader
        title="Delivery Dashboard"
        description="Notification delivery monitoring, retry, and health"
      >
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={fetchData} loading={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/notifications/history">
              <Mail className="h-4 w-4" />
              Email History
            </Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/reports/licence-expiry">
              <AlertTriangle className="h-4 w-4" />
              Licence Expiry
            </Link>
          </Button>
        </div>
      </PageHeader>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="pt-4 text-center">
              <p className={`text-2xl font-[650] tabular-nums ${stat.color}`}>
                {stat.value}
              </p>
              <div className="text-ink-500 mt-1 flex items-center justify-center gap-1 text-xs">
                {stat.icon}
                {stat.title}
              </div>
              {stat.description && (
                <p className="text-ink-400 mt-0.5 text-[10px]">{stat.description}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-ink-400" />
          <span className="text-xs font-medium text-ink-500">Filters:</span>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-[6px] border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700"
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="rounded-[6px] border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700"
        >
          {channelOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {(statusFilter || channelFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setChannelFilter(''); }}
            className="rounded-[6px] px-2 py-1 text-xs text-status-error-text hover:bg-status-error-bg transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-status-error-border bg-status-error-bg px-4 py-3 text-sm text-status-error-text">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="flex-1">{error}</p>
          <Button variant="secondary" size="compact" onClick={fetchData}>
            <RefreshCw className="h-3 w-3" /> Retry
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && deliveries.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center">
              <Send className="h-10 w-10 text-ink-300" />
              <p className="mt-3 text-sm font-medium text-ink-700">No delivery records</p>
              <p className="mt-1 text-xs text-ink-500">
                Delivery records will appear once notifications are sent.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delivery records table */}
      {!isLoading && deliveries.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border bg-muted border-b">
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">Status</th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">Title</th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">Channel</th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">Attempt</th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">Details</th>
                    <th className="text-ink-500 px-4 py-3 text-right text-xs font-medium tracking-wider uppercase">Date</th>
                    <th className="text-ink-500 px-4 py-3 text-center text-xs font-medium tracking-wider uppercase">Retry</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {deliveries.map((d) => (
                    <tr key={d.id} className="hover:bg-canvas/50 transition-colors">
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={getStatusVariant(d.status)}
                          label={d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-ink-950 max-w-[220px] truncate text-sm font-medium">
                          {d.notifTitle}
                        </p>
                        {d.notifBody && (
                          <p className="text-ink-500 max-w-[220px] truncate text-xs">
                            {d.notifBody}
                          </p>
                        )}
                        {d.entityType && (
                          <span className="text-ink-400 mt-0.5 inline-block text-[10px]">
                            {d.entityType}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="bg-muted text-ink-700 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium">
                          {getChannelIcon(d.channel)}
                          {getChannelLabel(d.channel)}
                        </span>
                      </td>
                      <td className="text-ink-500 px-4 py-3 text-xs tabular-nums">#{d.attempt}</td>
                      <td className="max-w-[200px] px-4 py-3">
                        {d.errorSummary ? (
                          <span className="text-status-error-text block truncate text-xs" title={d.errorSummary}>
                            {d.errorSummary}
                          </span>
                        ) : d.providerId ? (
                          <span className="text-ink-400 font-mono text-xs" title={d.providerId}>
                            {d.providerId.slice(0, 18)}...
                          </span>
                        ) : (
                          <span className="text-ink-400 text-xs">&mdash;</span>
                        )}
                      </td>
                      <td className="text-ink-500 px-4 py-3 text-right text-xs whitespace-nowrap">
                        {formatDate(d.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.status === 'failed' ? (
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => handleRetry(d.id)}
                            loading={retryingId === d.id}
                            disabled={retryingId !== null}
                          >
                            <RefreshCw className={`h-3 w-3 ${retryingId === d.id ? 'animate-spin' : ''}`} />
                            Retry
                          </Button>
                        ) : (
                          <span className="text-ink-300 text-xs">&mdash;</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
