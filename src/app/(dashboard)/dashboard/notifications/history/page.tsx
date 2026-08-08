import { getDb, isDbConnected } from '@/db';
import { notificationDeliveries, notifications } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Mail, Send, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { hasPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
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

function channelLabel(channel: string) {
  return channel === 'in_app' ? 'In-App' : channel.charAt(0).toUpperCase() + channel.slice(1);
}

export default async function EmailHistoryPage() {
  const session = await getServerSession();
  if (!session) notFound();

  const canView =
    (await hasPermission(session, Permissions.TENANT_MANAGE)) ||
    (await hasPermission(session, Permissions.AUDIT_READ));
  if (!canView) notFound();

  const breadcrumbs = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Notifications', href: '/dashboard/notifications' },
    { label: 'Delivery History' },
  ];

  if (!isDbConnected()) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <PageHeader title="Delivery History" description="Tenant-scoped notification delivery records" />
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
      <div className="space-y-5 sm:space-y-6">
        <Breadcrumbs items={breadcrumbs} />
        <PageHeader title="Delivery History" description="Tenant-scoped notification delivery records" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Delivery History" />
      </div>
    );
  }

  const { deliveries, metrics } = history;
  const summary = [
    { label: 'Total', value: metrics.total, tone: 'text-ink-950', icon: Mail },
    { label: 'Sent', value: metrics.sent, tone: 'text-status-success-text', icon: CheckCircle2 },
    { label: 'Failed', value: metrics.failed, tone: 'text-status-error-text', icon: XCircle },
    { label: 'Pending', value: metrics.pending, tone: 'text-status-pending-text', icon: Clock },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs items={breadcrumbs} />
      <PageHeader
        title="Delivery History"
        description={`${metrics.total} tenant delivery record${metrics.total === 1 ? '' : 's'} · ${metrics.email} email`}
      />

      <section aria-label="Delivery summary" className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border sm:grid-cols-4">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-surface min-h-16 px-3 py-3 sm:px-4">
              <p className={`text-xl font-semibold tabular-nums ${item.tone}`}>{item.value}</p>
              <p className="text-ink-500 mt-1 flex items-center gap-1.5 text-[11px]">
                <Icon className="h-3 w-3" aria-hidden="true" /> {item.label}
              </p>
            </div>
          );
        })}
      </section>

      {deliveries.length === 0 ? (
        <EmptyState
          icon={<Send className="h-6 w-6" />}
          title="No Delivery History"
          description="Delivery attempts will appear here when tenant notifications are sent through configured channels."
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {deliveries.map((delivery) => (
            <article key={delivery.id} className="border-border border-b px-4 py-4 last:border-b-0 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusBadge
                      status={deliveryStatusVariant[delivery.status] || 'pending'}
                      label={delivery.status.charAt(0).toUpperCase() + delivery.status.slice(1)}
                    />
                    <span className="bg-muted text-ink-600 inline-flex min-h-6 items-center gap-1 rounded-[6px] px-2 text-[11px] font-medium">
                      {delivery.channel === 'email' ? <Mail className="h-3 w-3" aria-hidden="true" /> : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
                      {channelLabel(delivery.channel)}
                    </span>
                    <span className="text-ink-400 text-[11px] tabular-nums">Attempt #{delivery.attempt}</span>
                  </div>
                  <h2 className="text-ink-950 mt-2 break-words text-sm font-semibold">{delivery.notifTitle}</h2>
                  {delivery.notifBody && <p className="text-ink-500 mt-1 line-clamp-2 text-xs leading-5">{delivery.notifBody}</p>}
                  {delivery.errorSummary ? (
                    <p className="text-status-error-text mt-2 break-words text-xs">{delivery.errorSummary}</p>
                  ) : delivery.providerId ? (
                    <p className="text-ink-400 mt-2 break-all font-mono text-[11px]">Provider: {delivery.providerId}</p>
                  ) : null}
                </div>
                <time className="text-ink-400 shrink-0 text-xs tabular-nums sm:text-right">{formatDateTime(delivery.createdAt)}</time>
              </div>
            </article>
          ))}
        </div>
      )}

      {deliveries.length === 100 && (
        <p className="text-ink-500 text-xs">Showing the latest 100 delivery attempts. Use the Delivery Dashboard for filtered operational monitoring and retry actions.</p>
      )}
    </div>
  );
}
