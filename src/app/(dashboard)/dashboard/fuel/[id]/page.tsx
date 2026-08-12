import { getDb, isDbConnected } from '@/db';
import { fuelTransactions, fuelReceipts, reimbursements } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database,
  Fuel,
  ChevronLeft,
  CalendarDays,
  Gauge,
  FileText,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions, getSessionRoleNames } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { FuelReviewActions } from './FuelReviewActions';
import { resolveDashboardAccess, type DashboardRecordScope } from '@/lib/dashboard-access';
import { fuelScopeCondition } from '@/lib/record-scope';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchFuelDetail(
  id: string,
  tenantId: string,
  userId: string,
  recordScope: DashboardRecordScope,
) {
  const db = getDb();
  const driverEmp = alias(employees, 'fuel_driver');
  const recorderEmp = alias(employees, 'fuel_recorder');

  const transaction = await db
    .select({
      id: fuelTransactions.id,
      transactionAt: fuelTransactions.transactionAt,
      stationName: fuelTransactions.stationName,
      fuelType: fuelTransactions.fuelType,
      litres: fuelTransactions.litres,
      amount: fuelTransactions.amount,
      odometerReading: fuelTransactions.odometerReading,
      referenceNumber: fuelTransactions.referenceNumber,
      paymentMethod: fuelTransactions.paymentMethod,
      fillType: fuelTransactions.fillType,
      anomalyState: fuelTransactions.anomalyState,
      anomalyNotes: fuelTransactions.anomalyNotes,
      isVerified: fuelTransactions.isVerified,
      createdAt: fuelTransactions.createdAt,
      vehicleId: fuelTransactions.vehicleId,
      tripId: fuelTransactions.tripId,
      driverEmployeeId: fuelTransactions.driverEmployeeId,
      driverName: sql<string>`concat_ws(' ', ${driverEmp.firstName}, ${driverEmp.lastName})`,
      recordedByName: sql<string>`concat_ws(' ', ${recorderEmp.firstName}, ${recorderEmp.lastName})`,
      make: vehicles.make,
      model: vehicles.model,
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
    })
    .from(fuelTransactions)
    .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
    .leftJoin(driverEmp, eq(fuelTransactions.driverEmployeeId, driverEmp.id))
    .leftJoin(recorderEmp, eq(fuelTransactions.recordedByUserId, recorderEmp.userId))
    .where(
      and(
        eq(fuelTransactions.id, id),
        fuelScopeCondition({ tenantId, userId, recordScope }),
      ),
    )
    .then((r) => r[0] ?? null);

  if (!transaction) notFound();

  const [receipts, reimbursement] = await Promise.all([
    db.select().from(fuelReceipts).where(eq(fuelReceipts.transactionId, id)),
    db
      .select({
        id: reimbursements.id,
        amount: reimbursements.amount,
        state: reimbursements.state,
        paidAt: reimbursements.paidAt,
        notes: reimbursements.notes,
      })
      .from(reimbursements)
      .where(eq(reimbursements.transactionId, id))
      .then((r) => r[0] ?? null),
  ]);

  return { transaction, receipts, reimbursement };
}

export default async function FuelDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) notFound();

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Fuel', href: '/dashboard/fuel' },
            { label: 'Transaction' },
          ]}
        />
        <PageHeader title="Fuel Transaction" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/fuel', roleNames);
  if (!access.allowed || !access.recordScope) notFound();

  let data: Awaited<ReturnType<typeof fetchFuelDetail>>;
  try {
    data = await fetchFuelDetail(id, session.tenantId, session.user.id, access.recordScope);
  } catch (error) {
    console.error('Fuel detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Fuel', href: '/dashboard/fuel' },
            { label: 'Transaction' },
          ]}
        />
        <PageHeader title="Fuel Transaction" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Transaction" />
      </div>
    );
  }

  const { transaction: t, receipts, reimbursement } = data;
  const permissions = await getSessionPermissions(session);
  const canVerify = access.actions.includes('update') && permissions.includes(Permissions.FUEL_VERIFY);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fuel', href: '/dashboard/fuel' },
          { label: `${t.licenceNumber} · ${formatDate(t.transactionAt)}` },
        ]}
      />
      <PageHeader
        title={`${t.make} ${t.model}`}
        description={`${t.licenceNumber}${t.vehicleRegisterNumber ? ` · ${t.vehicleRegisterNumber}` : ''} · ${formatDate(t.transactionAt)}`}
      >
        {!t.isVerified && canVerify && (
          <FuelReviewActions transactionId={t.id} anomalyState={t.anomalyState} />
        )}
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fuel">
            <ChevronLeft className="h-4 w-4" /> Back to Fuel
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] ${t.anomalyState !== 'none' ? 'bg-status-error-bg text-status-error-text' : 'bg-brand-50 text-brand-700'}`}
            >
              <Fuel className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-ink-950 text-lg font-semibold">
                  {t.make} {t.model}
                </h2>
                <Badge
                  variant={
                    t.paymentMethod === 'personal_reimbursement'
                      ? 'pending'
                      : t.paymentMethod === 'fuel_card'
                        ? 'info'
                        : 'default'
                  }
                  size="sm"
                >
                  {t.paymentMethod.replace(/_/g, ' ')}
                </Badge>
                {t.anomalyState !== 'none' && (
                  <Badge variant="error" size="sm">
                    Flagged: {t.anomalyState}
                  </Badge>
                )}
                <Badge variant={t.isVerified ? 'success' : 'pending'} size="sm">
                  {t.isVerified ? 'Verified' : 'Unverified'}
                </Badge>
              </div>
              <div className="text-ink-500 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDateTime(t.transactionAt)}
                </span>
                {t.stationName && <span>{t.stationName}</span>}
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  Ref: {t.referenceNumber || '—'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {t.anomalyNotes && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">Review note</p>
            <p className="mt-1 text-sm text-ink-800">{t.anomalyNotes}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transaction Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Fuel Type</span>
              <span className="text-ink-950 capitalize">{t.fuelType}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Litres</span>
              <span className="text-ink-950 tabular-nums">{Number(t.litres).toFixed(2)} L</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Amount</span>
              <span className="text-ink-950 tabular-nums font-medium">{formatCurrency(Number(t.amount))}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Payment</span>
              <span className="text-ink-950 capitalize">{t.paymentMethod.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Fill Type</span>
              <span className="text-ink-950 capitalize">{t.fillType?.replace(/_/g, ' ') || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Odometer</span>
              <span className="text-ink-950 tabular-nums flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5 text-ink-400" />
                {t.odometerReading ? `${t.odometerReading.toLocaleString()} km` : '—'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Driver</span>
              <span className="text-ink-950">{t.driverName || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Recorded By</span>
              <span className="text-ink-950">{t.recordedByName || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Recorded At</span>
              <span className="text-ink-950">{formatDateTime(t.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Verification</span>
              <span className={`flex items-center gap-1 text-sm ${t.isVerified ? 'text-status-success-text' : 'text-status-pending-text'}`}>
                {t.isVerified ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {t.isVerified ? 'Verified' : 'Pending'}
              </span>
            </div>
          </CardContent>
        </Card>

        {reimbursement && (
          <Card>
            <CardHeader>
              <CardTitle>Reimbursement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Amount</span>
                <span className="font-medium tabular-nums text-ink-950">{formatCurrency(Number(reimbursement.amount))}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Status</span>
                <Badge
                  variant={reimbursement.state === 'paid' ? 'success' : reimbursement.state === 'rejected' ? 'error' : 'pending'}
                  size="sm"
                >
                  {reimbursement.state}
                </Badge>
              </div>
              {reimbursement.paidAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-500">Paid</span>
                  <span className="text-ink-950">{formatDateTime(reimbursement.paidAt)}</span>
                </div>
              )}
              {reimbursement.notes && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-ink-500">Notes</p>
                  <p className="text-ink-700 text-sm">{reimbursement.notes}</p>
                </div>
              )}
              {access.recordScope === 'tenant' && (
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/dashboard/reimbursements/${reimbursement.id}`}>
                    Open reimbursement claim
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Receipts ({receipts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {receipts.length === 0 ? (
              <p className="text-sm text-ink-500">No receipt uploaded.</p>
            ) : (
              <div className="space-y-3">
                {receipts.map((receipt) => (
                  <div key={receipt.id} className="rounded-[8px] border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink-900">{receipt.originalFileName}</p>
                      <Badge variant={receipt.isVerified ? 'success' : 'pending'} size="sm">
                        {receipt.isVerified ? 'Verified' : receipt.ocrStatus.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">Uploaded {formatDateTime(receipt.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
