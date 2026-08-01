import { getDb, isDbConnected } from '@/db';
import { notificationDeliveries, notifications } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Mail, Send, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { numericCount } from '@/lib/statistics';

export const dynamic = 'force-dynamic';

async function fetchDeliveryHistory(tenantId: string) {
  const db = getDb();
  const tenantWhere = eq(notifications.tenantId, tenantId);
  const [deliveries, [metricRow]] = await Promise.all([
    db
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
      .where(tenantWhere)
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(100),
    db
      .select({
        total: sql<number>`count(*)`,
        email: sql<number>`count(*) filter (where ${notificationDeliveries.channel} = 'email')`,
        sent: sql<number>`count(*) filter (where ${notificationDeliveries.status} in ('sent', 'delivered'))`,
        failed: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'failed')`,
        pending: sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'pending')`,
      })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
      .where(tenantWhere),
  ]);

  return {
    deliveries,
    metrics: {
      total: numericCount(metricRow?.total),
      email: numericCount(metricRow?.email),
      sent: numericCount(metricRow?.sent),
      failed: numericCount(metricRow?.failed),
      pending: numericCount(metricRow?.pending),
    },
  };
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
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Notifications', href: '/dashboard/notifications' },
            { label: 'Email History' },
          ]}
        />
        <PageHeader title="Email History" description="Sent email notification log" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Notifications', href: '/dashboard/notifications' },
            { label: 'Email History' },
          ]}
        />
        <PageHeader title="Email History" description="Sent email notification log" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let history: Awaited<ReturnType<typeof fetchDeliveryHistory>>;
  try {
    history = await fetchDeliveryHistory(session.tenantId);
  } catch (error) {
    console.error('Delivery history query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Notifications', href: '/dashboard/notifications' },
            { label: 'Email History' },
          ]}
        />
        <PageHeader title="Email History" description="Sent email notification log" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load History" />
      </div>
    );
  }

  const { deliveries, metrics } = history;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Notifications', href: '/dashboard/notifications' },
          { label: 'Email History' },
        ]}
      />
      <PageHeader
        title="Email History"
        description={`${metrics.total} delivery records · ${metrics.sent} sent, ${metrics.failed} failed`}
      />

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{metrics.total}</p>
            <div className="text-ink-500 mt-1 flex items-center justify-center gap-1 text-xs">
              <Mail className="h-3 w-3" /> Total Deliveries
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-success-text text-2xl font-[650] tabular-nums">
              {metrics.sent}
            </p>
            <div className="text-ink-500 mt-1 flex items-center justify-center gap-1 text-xs">
              <CheckCircle2 className="h-3 w-3" /> Sent
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-error-text text-2xl font-[650] tabular-nums">
              {metrics.failed}
            </p>
            <div className="text-ink-500 mt-1 flex items-center justify-center gap-1 text-xs">
              <XCircle className="h-3 w-3" /> Failed
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-pending-text text-2xl font-[650] tabular-nums">
              {metrics.pending}
            </p>
            <div className="text-ink-500 mt-1 flex items-center justify-center gap-1 text-xs">
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
                  <tr className="border-border bg-muted border-b">
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                      Status
                    </th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                      Title
                    </th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                      Channel
                    </th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                      Attempt
                    </th>
                    <th className="text-ink-500 px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                      Error
                    </th>
                    <th className="text-ink-500 px-4 py-3 text-right text-xs font-medium tracking-wider uppercase">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {deliveries.map((d) => (
                    <tr key={d.id} className="hover:bg-canvas/50 transition-colors">
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={deliveryStatusVariant[d.status] || 'pending'}
                          label={d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-ink-950 max-w-[250px] truncate text-sm font-medium">
                          {d.notifTitle}
                        </p>
                        {d.notifBody && (
                          <p className="text-ink-500 max-w-[250px] truncate text-xs">
                            {d.notifBody}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="bg-muted text-ink-700 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium">
                          {d.channel === 'email' ? (
                            <Mail className="h-3 w-3" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          {d.channel}
                        </span>
                      </td>
                      <td className="text-ink-500 px-4 py-3 text-xs tabular-nums">#{d.attempt}</td>
                      <td className="max-w-[200px] px-4 py-3">
                        {d.errorSummary ? (
                          <span className="text-status-error-text block truncate text-xs">
                            {d.errorSummary}
                          </span>
                        ) : d.providerId ? (
                          <span className="text-ink-400 font-mono text-xs">
                            {d.providerId.slice(0, 16)}...
                          </span>
                        ) : (
                          <span className="text-ink-400 text-xs">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="text-ink-500 px-4 py-3 text-right text-xs whitespace-nowrap">
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
