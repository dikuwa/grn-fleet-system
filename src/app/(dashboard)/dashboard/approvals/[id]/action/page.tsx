import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { ApprovalActionPanel } from '@/components/approvals/approval-action-panel';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
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

  const title = buildApprovalRequestTitle({
    purpose: detail.instance.requestPurpose,
    routes: detail.routes.map((route) => ({
      originName: route.originName,
      destinationName: route.destinationName,
    })),
  });

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
