import { getDb, isDbConnected } from '@/db';
import { workflowInstances, workflowDefinitions, workflowSteps, workflowActions, emergencyOverrides } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, asc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, ChevronLeft, FileText, User, CalendarDays, CheckCircle2, XCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchApprovalDetail(id: string) {
  const db = getDb();

  const instance = await db
    .select({
      id: workflowInstances.id,
      status: workflowInstances.status,
      currentStepOrder: workflowInstances.currentStepOrder,
      createdAt: workflowInstances.createdAt,
      requestId: workflowInstances.requestId,
      definitionId: workflowInstances.definitionId,
      definitionName: workflowDefinitions.name,
      definitionVersion: workflowDefinitions.version,
      requestReference: transportRequests.reference,
      requestScope: transportRequests.scope,
      requestStatus: transportRequests.status,
      requestPurpose: transportRequests.purpose,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
    })
    .from(workflowInstances)
    .leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .where(eq(workflowInstances.id, id))
    .then((r) => r[0] ?? null);

  if (!instance) notFound();

  const [steps, actions, overrides] = await Promise.all([
    db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.definitionId, instance.definitionId))
      .orderBy(asc(workflowSteps.stepOrder)),
    db
      .select({
        id: workflowActions.id,
        stepOrder: workflowActions.stepOrder,
        actionType: workflowActions.actionType,
        result: workflowActions.result,
        comment: workflowActions.comment,
        isActing: workflowActions.isActing,
        createdAt: workflowActions.createdAt,
      })
      .from(workflowActions)
      .where(eq(workflowActions.instanceId, id))
      .orderBy(asc(workflowActions.createdAt)),
    db
      .select()
      .from(emergencyOverrides)
      .where(eq(emergencyOverrides.instanceId, id))
      .then((r) => r[0] ?? null),
  ]);

  return { instance, steps, actions, overrides };
}

export default async function ApprovalDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals', href: '/dashboard/approvals' }, { label: 'Approval' }]} />
        <PageHeader title="Approval Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchApprovalDetail>>;
  try {
    data = await fetchApprovalDetail(id);
  } catch (error) {
    console.error('Approval detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals', href: '/dashboard/approvals' }, { label: 'Approval' }]} />
        <PageHeader title="Approval Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Approval" />
      </div>
    );
  }

  const { instance: inst, steps, actions, overrides } = data;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Approvals', href: '/dashboard/approvals' },
        { label: inst.requestReference || 'Workflow' },
      ]} />
      <PageHeader
        title={inst.requestReference || 'Approval Workflow'}
        description={inst.definitionName || 'Workflow'}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/approvals"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
        {inst.status === 'active' && (
          <Button variant="primary" size="sm" asChild>
            <Link href={`/dashboard/approvals/${inst.id}/action`}>Take Action</Link>
          </Button>
        )}
      </PageHeader>

      {/* Summary Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] ${
              inst.status === 'completed' ? 'bg-status-success-bg text-status-success-text' :
              inst.status === 'cancelled' ? 'bg-status-cancelled-bg text-status-cancelled-text' :
              inst.status === 'overridden' ? 'bg-status-emergency-bg text-status-emergency-text' :
              'bg-status-info-bg text-status-info-text'
            }`}>
              {inst.status === 'completed' ? <CheckCircle2 className="h-7 w-7" /> :
               inst.status === 'cancelled' ? <XCircle className="h-7 w-7" /> :
               inst.status === 'overridden' ? <AlertTriangle className="h-7 w-7" /> :
               <FileText className="h-7 w-7" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">{inst.requestReference || 'No Reference'}</h2>
                <Badge variant={
                  inst.status === 'active' ? 'info' :
                  inst.status === 'completed' ? 'success' :
                  inst.status === 'overridden' ? 'emergency' : 'cancelled'
                } size="sm">{inst.status}</Badge>
                <Badge variant={inst.requestScope === 'national' ? 'emergency' : 'info'} size="sm">{inst.requestScope ?? 'regional'}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                {inst.requesterFirstName && <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{inst.requesterFirstName} {inst.requesterLastName}</span>}
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Created {formatDate(inst.createdAt)}</span>
                <span>Step {inst.currentStepOrder} of {steps.length}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Details Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workflow Steps Timeline */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Workflow Timeline</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {steps.map((step) => {
                const action = actions.find((a) => a.stepOrder === step.stepOrder);
                const isCurrentStep = step.stepOrder === inst.currentStepOrder && inst.status === 'active';
                const isComplete = !!action;

                return (
                  <div key={step.id} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        isComplete ? 'bg-status-success-bg text-status-success-text' :
                        isCurrentStep ? 'bg-status-info-bg text-status-info-text ring-2 ring-brand-200' :
                        'bg-muted text-ink-400'
                      }`}>
                        {isComplete ? <CheckCircle2 className="h-4 w-4" /> : isCurrentStep ? <ArrowRight className="h-4 w-4" /> : <div className="h-2 w-2 rounded-full bg-current" />}
                      </div>
                      <div className={`mt-1 h-full w-px ${isComplete ? 'bg-status-success-bg' : 'bg-border'}`} />
                    </div>
                    <div className="pb-4 flex-1">
                      <div className="flex items-center justify-between">
                        <p className={`text-sm font-medium ${isCurrentStep ? 'text-ink-950' : isComplete ? 'text-ink-950' : 'text-ink-500'}`}>
                          {step.label}
                        </p>
                        {action && (
                          <Badge variant={
                            action.result === 'approved' || action.result === 'released' || action.result === 'authorised' || action.result === 'acknowledged' ? 'success' :
                            action.result === 'rejected' || action.result === 'returned' ? 'error' : 'info'
                          } size="sm">{action.result}</Badge>
                        )}
                      </div>
                      {step.description && <p className="text-xs text-ink-500 mt-0.5">{step.description}</p>}
                      {action && (
                        <div className="mt-1 rounded-[6px] bg-muted px-3 py-1.5">
                          <p className="text-xs text-ink-500">{formatDateTime(action.createdAt)}</p>
                          {action.comment && <p className="text-xs text-ink-700 mt-0.5 italic">&ldquo;{action.comment}&rdquo;</p>}
                        </div>
                      )}
                      {isCurrentStep && !action && (
                        <p className="text-xs text-brand-600 mt-1 font-medium">Awaiting action...</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Emergency Override Banner */}
      {overrides && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-status-emergency-text shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-status-emergency-text">Emergency Override Applied</p>
                <p className="text-xs text-ink-500 mt-1">Reason: {overrides.reason}</p>
                <p className="text-xs text-ink-500">Bypassed steps: {overrides.bypassedSteps.join(', ')}</p>
                {overrides.requiresPostTripReview && <p className="text-xs text-status-pending-text mt-1">Post-trip review required.</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Actions History */}
      {actions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Action History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {actions.map((action) => (
                <div key={action.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={
                        action.result === 'approved' || action.result === 'released' || action.result === 'authorised' ? 'success' :
                        action.result === 'rejected' || action.result === 'returned' ? 'error' : 'info'
                      } size="sm">{action.result}</Badge>
                      <span className="text-xs text-ink-500">Step {action.stepOrder}</span>
                      {action.isActing && <Badge variant="pending" size="sm">Acting</Badge>}
                    </div>
                    <span className="text-xs text-ink-500">{formatDateTime(action.createdAt)}</span>
                  </div>
                  {action.comment && <p className="mt-1 text-xs text-ink-700">{action.comment}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
