import { getDb, isDbConnected } from '@/db';
import { notificationDeliveries, notifications } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Mail, Send, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function fetchDeliveryHistory(tenantId: string) {
  const db = getDb();
  return db
    .select({
      id: notificationDeliveries.id,
      channel: notificationDeliveries.channel,
      providerId: notificationDeliveries.providerId,
      attempt: notificationDeliveries.attempt,
      status: notificationDeliveries.status,
      errorSummary: notificationDeliveries.errorSummary,
      createdAt: notificationDeliveries.createdAt,
      notificationId: notificationDeliveries.notificationId,
      notifType: notifications.type,
      notifTitle: notifications.title,
      notifBody: notifications.body,
    })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
    .where(eq(notifications.tenantId, tenantId))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(100);
}

const deliveryStatusVariant: Record<string, 'success' | 'error' | 'pending' | 'info'> = {
  sent: 'success',
  delivered: 'success',
  pending: 'pending',
  failed: 'error',
  skipped: 'info',
};

export default async function EmailHistoryPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Notifications', href: '/dashboard/notifications' }, { label: 'Email History' }]} />
        <PageHeader title="Email History" description="Sent email notification log" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Notifications', href: '/dashboard/notifications' }, { label: 'Email History' }]} />
        <PageHeader title="Email History" description="Sent email notification log" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let deliveries: Awaited<ReturnType<typeof fetchDeliveryHistory>>;
  try {
    deliveries = await fetchDeliveryHistory(session.tenantId);
  } catch (error) {
    console.error('Delivery history query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Notifications', href: '/dashboard/notifications' }, { label: 'Email History' }]} />
        <PageHeader title="Email History" description="Sent email notification log" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load History" />
      </div>
    );
  }

  const emailCount = deliveries.filter((d) => d.channel === 'email').length;
  const sentCount = deliveries.filter((d) => d.status === 'sent' || d.status === 'delivered').length;
  const failedCount = deliveries.filter((d) => d.status === 'failed').length;
  const pendingCount = deliveries.filter((d) => d.status === 'pending').length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Notifications', href: '/dashboard/notifications' },
        { label: 'Email History' },
      ]} />
      <PageHeader
        title="Email History"
        description={`${deliveries.length} delivery records · ${sentCount} sent, ${failedCount} failed`}
      />

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{deliveries.length}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <Mail className="h-3 w-3" /> Total Deliveries
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-success-text">{sentCount}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <CheckCircle2 className="h-3 w-3" /> Sent
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{failedCount}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <XCircle className="h-3 w-3" /> Failed
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-pending-text">{pendingCount}</p>
            <div className="mt-1 flex items-center justify-center gap-1 text-xs text-ink-500">
              <Clock className="h-3 w-3" /> Pending
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delivery Records */}
      {deliveries.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<Send className="h-6 w-6" />}
              title="No Email History"
              description="Email delivery records will appear here once notifications are sent. Ensure Resend is configured."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Channel</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Attempt</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500">Error</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-ink-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deliveries.map((d) => (
                    <tr key={d.id} className="hover:bg-canvas/50 transition-colors">
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={deliveryStatusVariant[d.status] || 'pending'}
                          label={d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-ink-950 truncate max-w-[250px]">{d.notifTitle}</p>
                        {d.notifBody && (
                          <p className="text-xs text-ink-500 truncate max-w-[250px]">{d.notifBody}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-ink-700">
                          {d.channel === 'email' ? <Mail className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
                          {d.channel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-ink-500">#{d.attempt}</td>
                      <td className="px-4 py-3 max-w-[200px]">
                        {d.errorSummary ? (
                          <span className="text-xs text-status-error-text truncate block">{d.errorSummary}</span>
                        ) : d.providerId ? (
                          <span className="text-xs text-ink-400 font-mono">{d.providerId.slice(0, 16)}...</span>
                        ) : (
                          <span className="text-xs text-ink-400">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-ink-500 whitespace-nowrap">
                        {formatDateTime(d.createdAt)}
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
