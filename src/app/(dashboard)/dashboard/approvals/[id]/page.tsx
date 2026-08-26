import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Database } from 'lucide-react';
import {
  ApprovalDecisionWorkspace,
  type ApprovalDecisionWorkspaceData,
} from '@/components/approvals/approval-decision-workspace';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { isDbConnected } from '@/db';
import {
  buildApprovalAlerts,
  buildApprovalRequestTitle,
  buildStructuredDecisionBrief,
  type ApprovalBriefInput,
} from '@/lib/approval-decision';
import { generateApprovalDecisionBrief } from '@/lib/approval-decision-ai';
import { getApprovalDetail } from '@/lib/approval-detail';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { getServerSession } from '@/lib/session';

interface PageProps {
  params: Promise<{ id: string }>;
}

function stringValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return null;
}

export default async function ApprovalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) notFound();

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Approvals', href: '/dashboard/approvals' },
            { label: 'Approval' },
          ]}
        />
        <PageHeader title="Approval Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const permissions = await getSessionPermissions(session);
  const detail = await getApprovalDetail({
    instanceId: id,
    tenantId: session.tenantId,
    userId: session.user.id,
    permissionCodes: permissions,
  }).catch((error) => {
    console.error('Approval detail query failed:', error);
    return null;
  });
  if (!detail) notFound();

  const {
    instance,
    currentStep,
    steps,
    actions,
    activities,
    passengers,
    drivers,
    routes,
    attachments,
    allocation,
    revision,
    override,
  } = detail;
  const routeFacts = routes.map((route) => ({
    originName: route.originName,
    destinationName: route.destinationName,
    mappedDistanceKm: route.mappedDistanceKm,
    mappedDurationMinutes: route.mappedDurationMinutes,
    totalKilometres: route.totalKilometres,
    overrideReason: route.overrideReason,
    calculationTimestamp: route.calculationTimestamp?.toISOString() ?? null,
  }));
  const title = buildApprovalRequestTitle({ purpose: instance.requestPurpose, routes: routeFacts });
  const startAt = activities[0]?.startDate ?? null;
  const endAt = activities.at(-1)?.endDate ?? null;
  const origin = routes[0]?.originName ?? null;
  const destination = routes.at(-1)?.destinationName ?? null;
  const distanceKm = routes.reduce(
    (total, route) => total + (route.totalKilometres || route.mappedDistanceKm || 0),
    0,
  );
  const durationMinutes = routes.reduce(
    (total, route) => total + (route.mappedDurationMinutes || 0),
    0,
  );
  const requirements = (instance.vehicleRequirements || {}) as Record<string, unknown>;
  const requestedVehicle = stringValue(
    requirements,
    'vehicleType',
    'vehicleCategory',
    'category',
    'type',
  );
  const driverAssigned = Boolean(
    allocation?.driverEmployeeId ||
    instance.assignedDriverEmployeeId ||
    drivers.some((driver) => driver.driverType === 'assigned' || driver.isConfirmed),
  );
  const travellerCount = passengers.length + 1;
  const latestApproval = actions.at(-1);
  const currentStage = currentStep?.label || `Step ${instance.currentStepOrder}`;
  const fallbackFacts: ApprovalBriefInput = {
    travellerCount,
    origin,
    destination,
    startAt: startAt?.toISOString(),
    endAt: endAt?.toISOString(),
    purpose: instance.requestPurpose,
    finance: {
      requestOrigin: instance.requestOrigin,
      financialImpact: instance.financialImpact,
      tripCategory: instance.tripCategory,
      estimatedCost: instance.estimatedCost,
      currency: instance.currency,
      costCentre: instance.costCentre,
      fundingSource: instance.fundingSource,
      budgetReference: instance.budgetReference,
    },
    vehicleType: requestedVehicle,
    driverAssigned,
    specialAuthorityRequired: instance.specialAuthorityRequired,
    currentStage,
  };
  const fallbackBrief = buildStructuredDecisionBrief(fallbackFacts);
  const aiBrief = await generateApprovalDecisionBrief({
    tenantId: session.tenantId,
    requestId: instance.requestId,
    requestVersion: instance.revision,
    facts: fallbackFacts,
  });
  const alerts = buildApprovalAlerts({
    scope: instance.requestScope,
    specialAuthorityRequired: instance.specialAuthorityRequired,
    specialAuthorityReason: instance.specialAuthorityReason,
    attachmentCount: attachments.length,
    travellerCount,
    requesterIsPassenger: passengers.some(
      (passenger) => passenger.employeeId === instance.requesterEmployeeId,
    ),
    routes: routeFacts,
    departureAt: startAt?.toISOString(),
    driverAssigned,
    hasDriverWithUnvalidatedLicence: drivers.some((driver) => !driver.licenceValidated),
    vehicleAssigned: Boolean(allocation),
    vehicleCapacity: allocation?.seatedCapacity,
    requestUpdatedAt: instance.requestUpdatedAt.toISOString(),
    latestApprovalAt: latestApproval?.createdAt.toISOString(),
    revision: instance.revision,
    hasActingApproval: actions.some((action) => action.isActing),
  });
  if (override) {
    alerts.unshift({
      id: 'emergency-override',
      tone: 'warning',
      title: 'Emergency override applied',
      detail: `${override.reason} Bypassed steps: ${override.bypassedSteps.join(', ')}.`,
    });
  }
  // Conflict-of-interest guard: surface why a requester cannot decide on their own request
  if (instance.requesterUserId === session.user.id) {
    alerts.unshift({
      id: 'self-approval-conflict',
      tone: 'warning',
      title: 'Conflict of interest — you requested this trip',
      detail: 'You cannot approve or act on a request you created. Another officer with the required permission must decide this step.',
    });
  }

  const stepByOrder = new Map(steps.map((step) => [step.stepOrder, step]));
  const actionByOrder = new Map(actions.map((action) => [action.stepOrder, action]));
  const workspaceData: ApprovalDecisionWorkspaceData = {
    instanceId: instance.id,
    requestId: instance.requestId,
    title,
    reference: instance.requestReference,
    workflowName: instance.definitionName || `${instance.requestScope} trip workflow`,
    scope: instance.requestScope,
    requestStatus: instance.requestStatus,
    workflowStatus: instance.status,
    currentStepOrder: instance.currentStepOrder,
    stepCount: steps.length,
    currentStepLabel: currentStage,
    currentStepDescription: currentStep?.description,
    purpose: instance.requestPurpose,
    requester: {
      name:
        [instance.requesterFirstName, instance.requesterLastName].filter(Boolean).join(' ') ||
        'Not provided',
      employeeNumber: instance.requesterEmployeeNumber,
      jobTitle: instance.requesterJobTitle,
      department: instance.requestDepartment,
      directorate: instance.requesterDirectorate,
    },
    journey: {
      startAt: startAt?.toISOString(),
      endAt: endAt?.toISOString(),
      origin,
      destination,
      distanceKm: distanceKm || instance.totalAuthorisedKilometres,
      durationMinutes: durationMinutes || null,
      routeSource: routes.some((route) => route.overrideReason)
        ? 'Mapped route with manual override'
        : routes.some((route) => route.calculationTimestamp)
          ? 'Automatically calculated route'
          : routes.length
            ? 'Manually entered route'
            : 'Not provided',
      routes: routes.map((route) => ({
        id: route.id,
        origin: route.originName,
        destination: route.destinationName,
        distanceKm: route.totalKilometres || route.mappedDistanceKm,
        durationMinutes: route.mappedDurationMinutes,
        overrideReason: route.overrideReason,
      })),
    },
    activities: activities.map((activity) => ({
      id: activity.id,
      title: activity.title,
      description: activity.description,
      venue: activity.venue,
      startAt: activity.startDate.toISOString(),
      endAt: activity.endDate.toISOString(),
    })),
    passengers: passengers.map((passenger) => ({
      id: passenger.id,
      name: passenger.employeeId
        ? passenger.employeeName || 'Employee name not provided'
        : passenger.externalName || 'External traveller',
      employeeNumber: passenger.employeeNumber,
      organisation: passenger.externalOrganisation,
      role: passenger.travellerRole,
      reason: passenger.reasonForTravel,
      external: !passenger.employeeId,
    })),
    drivers: drivers.map((driver) => ({
      id: driver.id,
      name: driver.employeeName || 'Driver name not provided',
      employeeNumber: driver.employeeNumber,
      type: driver.driverType,
      confirmed: driver.isConfirmed,
      licenceValidated: driver.licenceValidated,
    })),
    vehicle: {
      requestedType: requestedVehicle,
      terrain: stringValue(requirements, 'terrain', 'roadType'),
      luggage: stringValue(requirements, 'luggage', 'equipment', 'luggageEquipment'),
      fuelAdvance: stringValue(requirements, 'fuelAdvance', 'fuel', 'advanceRequested'),
      accommodation: stringValue(requirements, 'accommodation', 'overnightAccommodation'),
      accessibilityNeeds: stringValue(requirements, 'accessibilityNeeds', 'specialTravelNeeds'),
      assignedLabel: allocation
        ? `${allocation.make} ${allocation.model} · ${allocation.licenceNumber}`
        : null,
      allocationState: allocation?.state,
    },
    logistics: {
      driverPreference: instance.driverPreference,
      specialRequirements: instance.specialRequirements,
      specialAuthorityRequired: instance.specialAuthorityRequired,
      specialAuthorityReason: instance.specialAuthorityReason,
      specialAuthorityApproved: instance.specialAuthorityApproved,
    },
    approvalContext: {
      driverAssigned,
      vehicleAssigned: Boolean(allocation),
      attachmentCount: attachments.length,
      requesterDeclaration:
        instance.employeeConfirmationStatus === 'confirmed'
          ? 'Confirmed by requester'
          : instance.employeeConfirmationStatus || 'Not recorded',
      revision: instance.revision,
      changedFields: Object.keys(revision?.changedFields || {}).map((field) =>
        field.replaceAll('_', ' '),
      ),
      requiredNextStep:
        instance.status === 'active'
          ? currentStep?.description || currentStage
          : 'Workflow already completed',
    },
    brief: { text: aiBrief || fallbackBrief, aiGenerated: Boolean(aiBrief) },
    alerts,
    steps: steps.map((step) => {
      const action = actionByOrder.get(step.stepOrder);
      return {
        id: step.id,
        order: step.stepOrder,
        label: step.label,
        description: step.description,
        actionType: step.actionType,
        action: action
          ? {
              result: action.result,
              comment: action.comment,
              actorName: action.actorName,
              acting: action.isActing,
              createdAt: action.createdAt.toISOString(),
            }
          : undefined,
      };
    }),
    actions: actions.map((action) => ({
      id: action.id,
      stepOrder: action.stepOrder,
      stage: stepByOrder.get(action.stepOrder)?.label || action.actionType,
      result: action.result,
      actorName: action.actorName,
      actorRole: stepByOrder.get(action.stepOrder)?.label || 'Approval officer',
      acting: action.isActing,
      comment: action.comment,
      createdAt: action.createdAt.toISOString(),
    })),
    canAct: detail.canAct,
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Approvals', href: '/dashboard/approvals' },
          { label: instance.requestReference },
        ]}
      />
      <PageHeader
        title={title}
        description={`Transport Request · ${instance.requestReference} · ${workspaceData.workflowName} · Step ${instance.currentStepOrder} of ${steps.length}`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/approvals">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
            </Link>
          </Button>
          {detail.canAct && (
            <Button variant="primary" size="sm" asChild>
              <Link href={`/dashboard/approvals/${instance.id}/action`}>
                Review &amp; Take Action
              </Link>
            </Button>
          )}
        </div>
      </PageHeader>
      <ApprovalDecisionWorkspace data={workspaceData} />
    </div>
  );
}
