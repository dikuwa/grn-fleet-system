import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Truck } from 'lucide-react';
import { ApprovalActionPanel } from '@/components/approvals/approval-action-panel';
import { TransportDecisionPanel } from '@/components/approvals/transport-decision-panel';
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
  const operationalAssignmentReady = Boolean(
    detail.allocation?.id &&
      detail.allocation.state === 'confirmed' &&
      detail.allocation.vehicleId &&
      detail.allocation.driverEmployeeId,
  );

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
