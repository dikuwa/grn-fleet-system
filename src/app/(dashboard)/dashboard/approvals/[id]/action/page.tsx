import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Truck } from 'lucide-react';
import { ApprovalActionPanel } from '@/components/approvals/approval-action-panel';
import { TransportAllocationAdjustments } from '@/components/approvals/transport-allocation-adjustments';
import { TransportDecisionPanel } from '@/components/approvals/transport-decision-panel';
import { TransportReviewRequestCorrections } from '@/components/approvals/transport-review-request-corrections';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildApprovalRequestTitle } from '@/lib/approval-decision';
import { getApprovalDetail } from '@/lib/approval-detail';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { getServerSession } from '@/lib/session';

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
  const hasCurrentDriver = Boolean(
    detail.allocation?.driverEmployeeId || detail.externalDriverAssignment,
  );
  const operationalAssignmentReady = Boolean(
    detail.allocation?.id &&
      detail.allocation.state === 'confirmed' &&
      detail.allocation.vehicleId &&
      hasCurrentDriver,
  );
  const driverSummary = detail.allocation?.driverEmployeeId
    ? 'employee driver assigned'
    : detail.externalDriverAssignment
      ? `external driver ${detail.externalDriverAssignment.firstName} ${detail.externalDriverAssignment.lastName} (${detail.externalDriverAssignment.state.replaceAll('_', ' ')})`
      : 'driver not assigned';
  const hasInternalDriver = Boolean(detail.allocation?.driverEmployeeId);

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

      {isTransportReview && (
        <TransportReviewRequestCorrections
          requestId={detail.instance.requestId}
          requestReference={detail.instance.requestReference}
          purpose={detail.instance.requestPurpose || ''}
          specialRequirements={detail.instance.specialRequirements || ''}
          activities={detail.activities}
          allocationId={detail.allocation?.id || null}
        />
      )}

      {isTransportReview && operationalAssignmentReady && detail.allocation && hasInternalDriver ? (
        <TransportAllocationAdjustments
          allocationId={detail.allocation.id}
          requestId={detail.instance.requestId}
          requestReference={detail.instance.requestReference}
          currentVehicle={{
            id: detail.allocation.vehicleId,
            make: detail.allocation.make,
            model: detail.allocation.model,
            licenceNumber: detail.allocation.licenceNumber,
          }}
          currentDriverEmployeeId={detail.allocation.driverEmployeeId}
          driverSummary={driverSummary}
        />
      ) : isTransportReview && operationalAssignmentReady && detail.allocation ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-status-success-bg text-status-success-text">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-950">External driver assignment ready</p>
                <p className="mt-1 text-xs leading-5 text-ink-500">
                  {detail.allocation.make} {detail.allocation.model} · {detail.allocation.licenceNumber} · {driverSummary}.
                  External-driver changes remain on the dedicated allocation path so licence verification and assignment state are preserved.
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
