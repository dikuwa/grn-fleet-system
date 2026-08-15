import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CalendarClock, CheckCircle2, ChevronLeft, MapPin, ShieldCheck, Truck, UserRound } from 'lucide-react';
import { ApprovalActionPanel } from '@/components/approvals/approval-action-panel';
import { TransportDecisionPanel } from '@/components/approvals/transport-decision-panel';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildApprovalRequestTitle } from '@/lib/approval-decision';
import { getApprovalDetail } from '@/lib/approval-detail';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { getServerSession } from '@/lib/session';
import { formatDate } from '@/lib/utils';

export default async function ApprovalActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) notFound();
  const permissionCodes = await getSessionPermissions(session);
  const detail = await getApprovalDetail({
    instanceId: id,
    tenantId: session.tenantId,
    userId: session.user.id,
    permissionCodes,
  });
  if (!detail) notFound();
  if (!detail.canAct || !detail.currentStep || detail.instance.status !== 'active') {
    redirect(`/dashboard/approvals/${id}`);
  }

  // Driver acknowledgement is intentionally completed from the assigned trip,
  // where the driver must verify vehicle, authority, route, passenger manifest,
  // licence validity, responsibility and special conditions. Do not expose a
  // second generic approval writer for the same lifecycle transition.
  if (detail.currentStep.actionType === 'acknowledge') {
    redirect('/dashboard/trips');
  }

  const title = buildApprovalRequestTitle({
    purpose: detail.instance.requestPurpose,
    routes: detail.routes.map((route) => ({
      originName: route.originName,
      destinationName: route.destinationName,
    })),
  });

  const isTransportReview = detail.currentStep.actionType === 'transport_review';
  const operationalAssignmentReady = Boolean(
    detail.allocation?.id &&
      detail.allocation.state === 'confirmed' &&
      detail.allocation.vehicleId &&
      detail.allocation.driverEmployeeId,
  );
  const primaryDriver = detail.drivers.find(
    (driver) => driver.driverType === 'assigned' || driver.isConfirmed,
  ) ?? detail.drivers[0];
  const origin = detail.routes[0]?.originName || 'Not recorded';
  const destination = detail.routes.at(-1)?.destinationName || 'Not recorded';
  const startAt = detail.activities[0]?.startDate ?? null;
  const endAt = detail.activities.at(-1)?.endDate ?? null;
  const showDecisionContext = !isTransportReview;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Approvals', href: '/dashboard/approvals' },
          { label: detail.instance.requestReference, href: `/dashboard/approvals/${id}` },
          { label: 'Decision' },
        ]}
      />
      <PageHeader
        title={`Decision: ${detail.currentStep.label}`}
        description={`${title} · ${detail.instance.requestReference}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/approvals/${id}`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back to Review
          </Link>
        </Button>
      </PageHeader>

      {showDecisionContext && (
        <section aria-labelledby="decision-context-heading" className="border-border bg-surface rounded-[10px] border px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="decision-context-heading" className="text-ink-950 text-sm font-semibold">Decision context</h2>
            <Badge variant={detail.instance.requestScope === 'national' ? 'emergency' : 'info'} size="sm">
              {detail.instance.requestScope === 'national' ? 'National trip' : 'Regional trip'}
            </Badge>
            {detail.instance.specialAuthorityRequired && (
              <Badge variant={detail.instance.specialAuthorityApproved ? 'success' : 'warning'} size="sm">
                Special authority {detail.instance.specialAuthorityApproved ? 'approved' : 'required'}
              </Badge>
            )}
          </div>
          <p className="text-ink-500 mt-1 text-xs">Essential operational facts remain visible while you make this decision. Return to the full review for the complete history and supporting evidence.</p>

          <div className="border-border mt-4 grid gap-px overflow-hidden rounded-[8px] border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-surface flex min-w-0 gap-2.5 p-3">
              <MapPin className="text-ink-400 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-ink-500 text-[11px] font-medium uppercase tracking-wide">Route</p>
                <p className="text-ink-950 mt-0.5 truncate text-sm font-medium" title={`${origin} → ${destination}`}>{origin} → {destination}</p>
              </div>
            </div>
            <div className="bg-surface flex min-w-0 gap-2.5 p-3">
              <CalendarClock className="text-ink-400 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-ink-500 text-[11px] font-medium uppercase tracking-wide">Travel</p>
                <p className="text-ink-950 mt-0.5 text-sm font-medium">
                  {startAt ? formatDate(startAt) : 'Not scheduled'}{endAt ? ` – ${formatDate(endAt)}` : ''}
                </p>
              </div>
            </div>
            <div className="bg-surface flex min-w-0 gap-2.5 p-3">
              <Truck className="text-ink-400 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-ink-500 text-[11px] font-medium uppercase tracking-wide">Vehicle</p>
                <p className="text-ink-950 mt-0.5 truncate text-sm font-medium">
                  {detail.allocation ? `${detail.allocation.make} ${detail.allocation.model} · ${detail.allocation.licenceNumber}` : 'Not assigned'}
                </p>
              </div>
            </div>
            <div className="bg-surface flex min-w-0 gap-2.5 p-3">
              <UserRound className="text-ink-400 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-ink-500 text-[11px] font-medium uppercase tracking-wide">Driver</p>
                <p className="text-ink-950 mt-0.5 truncate text-sm font-medium">
                  {primaryDriver?.employeeName || 'Not assigned'}
                </p>
                {primaryDriver && (
                  <p className="text-ink-500 mt-0.5 text-[11px]">
                    Licence {primaryDriver.licenceValidated ? 'validated' : 'requires review'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {detail.currentStep.actionType === 'authorise' && (
            <div className="text-ink-600 mt-3 flex items-start gap-2 text-xs leading-5">
              <ShieldCheck className="text-status-success-text mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Final authorisation will provision the canonical Trip Authority for the current confirmed vehicle and driver assignment, then hand the trip to the assigned driver for acknowledgement.</span>
            </div>
          )}
        </section>
      )}

      {isTransportReview && operationalAssignmentReady && detail.allocation ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="bg-status-success-bg text-status-success-text flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-ink-950 text-sm font-semibold">Operational assignment ready</p>
                <p className="text-ink-500 mt-1 text-xs leading-5">
                  {detail.allocation.make} {detail.allocation.model} · {detail.allocation.licenceNumber} · confirmed vehicle and driver assignment.
                  Use Allocation Detail for any vehicle or driver replacement so the mandatory reason and audit trail are captured.
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" asChild className="w-full sm:w-auto">
              <Link href={`/dashboard/allocations/${detail.allocation.id}`}>
                <Truck className="h-4 w-4" aria-hidden="true" /> Manage Allocation
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : isTransportReview ? (
        <TransportDecisionPanel
          requestId={detail.instance.requestId}
          requestReference={detail.instance.requestReference}
          requestTitle={title}
          activities={detail.activities}
          existingAllocation={detail.allocation}
        />
      ) : null}

      <ApprovalActionPanel
        instanceId={id}
        requestTitle={title}
        requestReference={detail.instance.requestReference}
        stageLabel={detail.currentStep.label}
        actionType={detail.currentStep.actionType}
        stepRequiresComment={detail.currentStep.requiresComment}
        nextStageLabel={detail.nextStep?.label}
        isFinalStage={!detail.nextStep}
      />
    </div>
  );
}
