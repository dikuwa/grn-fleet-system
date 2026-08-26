'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileText,
  Info,
  MapPin,
  Paperclip,
  Route,
  UserRound,
  Users,
} from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApprovalAlert } from '@/lib/approval-decision';
import { cn } from '@/lib/utils';

export type ApprovalDecisionWorkspaceData = {
  instanceId: string;
  requestId: string;
  title: string;
  reference: string;
  workflowName: string;
  scope: string;
  requestStatus: string;
  workflowStatus: string;
  currentStepOrder: number;
  stepCount: number;
  currentStepLabel: string;
  currentStepDescription?: string | null;
  purpose?: string | null;
  finance: {
    requestOrigin: string;
    financialImpact: string;
    tripCategory: string;
    estimatedCost?: string | null;
    currency: string;
    costCentre?: string | null;
    fundingSource?: string | null;
    budgetReference?: string | null;
  };
  requester: {
    name: string;
    employeeNumber?: string | null;
    jobTitle?: string | null;
    department?: string | null;
    directorate?: string | null;
  };
  journey: {
    startAt?: string | null;
    endAt?: string | null;
    origin?: string | null;
    destination?: string | null;
    distanceKm?: number | null;
    durationMinutes?: number | null;
    routeSource: string;
    routes: Array<{
      id: string;
      origin?: string | null;
      destination?: string | null;
      distanceKm?: number | null;
      durationMinutes?: number | null;
      overrideReason?: string | null;
    }>;
  };
  activities: Array<{
    id: string;
    title: string;
    description?: string | null;
    venue?: string | null;
    startAt: string;
    endAt: string;
  }>;
  passengers: Array<{
    id: string;
    name: string;
    employeeNumber?: string | null;
    organisation?: string | null;
    role: string;
    reason?: string | null;
    external: boolean;
  }>;
  drivers: Array<{
    id: string;
    name: string;
    employeeNumber?: string | null;
    type: string;
    confirmed: boolean;
    licenceValidated: boolean;
  }>;
  vehicle: {
    requestedType?: string | null;
    terrain?: string | null;
    luggage?: string | null;
    fuelAdvance?: string | null;
    accommodation?: string | null;
    accessibilityNeeds?: string | null;
    assignedLabel?: string | null;
    allocationState?: string | null;
  };
  logistics: {
    driverPreference: string;
    specialRequirements?: string | null;
    specialAuthorityRequired: boolean;
    specialAuthorityReason?: string | null;
    specialAuthorityApproved?: boolean | null;
  };
  approvalContext: {
    driverAssigned: boolean;
    vehicleAssigned: boolean;
    attachmentCount: number;
    requesterDeclaration: string;
    revision: number;
    changedFields: string[];
    requiredNextStep: string;
  };
  brief: { text: string; aiGenerated: boolean };
  alerts: ApprovalAlert[];
  steps: Array<{
    id: string;
    order: number;
    label: string;
    description?: string | null;
    actionType: string;
    action?: {
      result: string;
      comment?: string | null;
      actorName?: string | null;
      acting: boolean;
      createdAt: string;
    };
  }>;
  actions: Array<{
    id: string;
    stepOrder: number;
    stage: string;
    result: string;
    actorName?: string | null;
    actorRole: string;
    acting: boolean;
    comment?: string | null;
    createdAt: string;
  }>;
  canAct: boolean;
};

const dateFormatter = new Intl.DateTimeFormat('en-NA', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(value?: string | null) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not provided' : dateFormatter.format(date);
}

function formatDuration(minutes?: number | null) {
  if (!minutes) return 'Not provided';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours ? `${hours}h ` : ''}${remainder ? `${remainder}m` : ''}`.trim();
}

function humanize(value?: string | null) {
  if (!value) return 'Not provided';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Detail({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-500 text-xs font-medium">{label}</dt>
      <dd className="overflow-wrap-anywhere text-ink-950 mt-1 text-sm">
        {value || 'Not provided'}
      </dd>
    </div>
  );
}

function CompactMetadata({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0 pl-10">
      <dt className="text-ink-500 text-[11px] font-medium">
        <span
          className="bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-200 absolute top-0 left-0 flex h-8 w-8 items-center justify-center rounded-[8px]"
          aria-hidden="true"
        >
          {icon}
        </span>
        {label}
      </dt>
      <dd className="overflow-wrap-anywhere text-ink-950 mt-0.5 text-sm leading-5 font-medium">
        {value}
        {detail && (
          <span className="overflow-wrap-anywhere text-ink-500 mt-0.5 block text-xs leading-4">
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

function SummarySection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="border-border min-w-0 rounded-[10px] border p-4"
      aria-labelledby={`section-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`}
    >
      <h3
        id={`section-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`}
        className="text-ink-950 mb-3 flex items-center gap-2 text-sm font-semibold"
      >
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function statusVariant(result: string) {
  if (['approved', 'released', 'authorised', 'acknowledged', 'completed'].includes(result)) {
    return 'success' as const;
  }
  if (['rejected', 'returned', 'cancelled'].includes(result)) return 'error' as const;
  return 'info' as const;
}

function PeopleList({ people }: { people: ApprovalDecisionWorkspaceData['passengers'] }) {
  const visible = people.slice(0, 4);
  const remaining = people.slice(4);
  const row = (person: (typeof people)[number]) => (
    <li key={person.id} className="border-border min-w-0 border-b py-2 last:border-0">
      <p className="overflow-wrap-anywhere text-ink-950 text-sm font-medium">{person.name}</p>
      <p className="overflow-wrap-anywhere text-ink-500 text-xs">
        {person.employeeNumber ||
          (person.external ? 'External traveller' : 'Employee number not provided')}
        {person.role ? ` · ${humanize(person.role)}` : ''}
        {person.organisation ? ` · ${person.organisation}` : ''}
      </p>
      {person.reason && <p className="text-ink-600 mt-1 text-xs">{person.reason}</p>}
    </li>
  );
  return (
    <>
      {people.length ? (
        <ul>{visible.map(row)}</ul>
      ) : (
        <p className="text-ink-500 text-sm">No additional passengers listed.</p>
      )}
      {remaining.length > 0 && (
        <details className="mt-2">
          <summary className="touch-target text-brand-700 focus-ring inline-flex cursor-pointer items-center text-xs font-medium">
            View all {people.length} passengers
          </summary>
          <ul>{remaining.map(row)}</ul>
        </details>
      )}
    </>
  );
}

const subscribeToClientMount = () => () => undefined;

function MobileApprovalAction({ href }: { href: string }) {
  const mounted = useSyncExternalStore(
    subscribeToClientMount,
    () => true,
    () => false,
  );

  if (!mounted) return null;

  return createPortal(
    <div
      data-testid="mobile-approval-action"
      className="border-border bg-surface/95 fixed inset-x-3 z-40 rounded-[10px] border p-2 shadow-lg backdrop-blur md:hidden"
      style={{
        bottom: 'calc(var(--mobile-nav-height, 64px) + env(safe-area-inset-bottom, 0px) + 0.5rem)',
      }}
    >
      <Button variant="primary" className="w-full" asChild>
        <Link href={href}>Review &amp; Take Action</Link>
      </Button>
    </div>,
    document.body,
  );
}

export function ApprovalDecisionWorkspace({ data }: { data: ApprovalDecisionWorkspaceData }) {
  const [expanded, setExpanded] = useState(false);
  const travellerCount = data.passengers.length + 1;
  const journeyDetail = [
    data.journey.distanceKm ? `${data.journey.distanceKm.toLocaleString()} km` : null,
    data.journey.durationMinutes ? formatDuration(data.journey.durationMinutes) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-testid="approval-decision-workspace"
      className={cn('space-y-6', data.canAct && 'pb-24 md:pb-0')}
    >
      <Card>
        <CardHeader className="border-border border-b">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="overflow-wrap-anywhere text-lg">Request Summary</CardTitle>
              <p className="overflow-wrap-anywhere text-ink-500 mt-1 text-xs">{data.reference}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant={statusVariant(data.workflowStatus)} size="sm">
                  {humanize(data.workflowStatus)}
                </Badge>
                <Badge variant={data.scope === 'national' ? 'emergency' : 'info'} size="sm">
                  {humanize(data.scope)} trip
                </Badge>
                <Badge variant="pending" size="sm">
                  Step {data.currentStepOrder} of {data.stepCount}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          <dl className="grid min-w-0 grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-5">
            <CompactMetadata
              icon={<UserRound className="h-4 w-4" />}
              label="Requester"
              value={data.requester.name}
              detail={data.requester.jobTitle || 'Requester'}
            />
            <CompactMetadata
              icon={<Building2 className="h-4 w-4" />}
              label="Department / Directorate"
              value={data.requester.department || data.requester.directorate}
              detail={data.requester.department && data.requester.directorate}
            />
            <CompactMetadata
              icon={<CalendarDays className="h-4 w-4" />}
              label="Travel dates"
              value={formatDateTime(data.journey.startAt)}
              detail={`Returns ${formatDateTime(data.journey.endAt)}`}
            />
            <CompactMetadata
              icon={<Route className="h-4 w-4" />}
              label="Route"
              value={`${data.journey.origin || 'Not provided'} → ${data.journey.destination || 'Not provided'}`}
              detail={journeyDetail || 'Distance and duration not provided'}
            />
            <CompactMetadata
              icon={<Users className="h-4 w-4" />}
              label="Travellers / vehicle"
              value={`${travellerCount} ${travellerCount === 1 ? 'traveller' : 'travellers'}`}
              detail={data.vehicle.requestedType || 'Vehicle type not provided'}
            />
          </dl>

          <section
            className="bg-brand-50/70 dark:bg-brand-950/30 border-brand-200 dark:border-brand-900 rounded-[10px] border p-4"
            aria-labelledby="decision-brief-title"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="decision-brief-title"
                className="text-brand-900 text-sm font-semibold dark:text-white"
              >
                {data.brief.aiGenerated ? 'Decision Brief (AI Generated)' : 'Decision Brief'}
              </h2>
              {!data.brief.aiGenerated && (
                <Badge variant="info" size="sm">
                  Structured summary
                </Badge>
              )}
            </div>
            <p className="overflow-wrap-anywhere text-ink-800 mt-2 text-sm leading-6 dark:text-white/90">
              {data.brief.text}
            </p>
            {data.brief.aiGenerated && (
              <p className="text-ink-500 mt-2 text-xs dark:text-white/70">
                AI can make mistakes. Verify important details below.
              </p>
            )}
          </section>

          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="approval-request-details"
            onClick={() => setExpanded((current) => !current)}
            className="focus-ring border-border text-brand-700 hover:bg-muted flex min-h-11 w-full items-center justify-between rounded-[8px] border px-3 py-2 text-left text-sm font-medium"
          >
            {expanded ? 'Collapse request details' : 'Expand request details'}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
              aria-hidden="true"
            />
          </button>

          {expanded && (
            <div
              id="approval-request-details"
              data-testid="approval-request-details"
              className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-5"
            >
              <SummarySection
                title="Journey"
                icon={<Route className="h-4 w-4" aria-hidden="true" />}
              >
                <dl className="grid min-w-0 grid-cols-1 gap-3">
                  <Detail label="Origin" value={data.journey.origin} />
                  <Detail label="Destination" value={data.journey.destination} />
                  <Detail label="Departure" value={formatDateTime(data.journey.startAt)} />
                  <Detail label="Return" value={formatDateTime(data.journey.endAt)} />
                  <Detail
                    label="Estimated distance"
                    value={
                      data.journey.distanceKm
                        ? `${data.journey.distanceKm.toLocaleString()} km`
                        : undefined
                    }
                  />
                  <Detail
                    label="Estimated duration"
                    value={formatDuration(data.journey.durationMinutes)}
                  />
                  <Detail label="Trip scope" value={humanize(data.scope)} />
                  <Detail label="Route source" value={data.journey.routeSource} />
                </dl>
                {data.journey.routes.length > 1 && (
                  <ol className="border-border mt-3 space-y-2 border-t pt-3">
                    {data.journey.routes.map((route, index) => (
                      <li key={route.id} className="text-ink-700 text-xs">
                        <span className="font-medium">Leg {index + 1}:</span>{' '}
                        {route.origin || 'Not provided'} → {route.destination || 'Not provided'}
                        {route.distanceKm ? ` · ${route.distanceKm} km` : ''}
                      </li>
                    ))}
                  </ol>
                )}
              </SummarySection>

              <SummarySection
                title="Purpose & Programme"
                icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
              >
                <dl className="space-y-3">
                  <Detail label="Purpose / reason for travel" value={data.purpose} />
                  <Detail label="Programme or activity" value={data.activities[0]?.title} />
                  <Detail label="Venue" value={data.activities[0]?.venue} />
                  <Detail
                    label="Expected outcome / details"
                    value={data.activities[0]?.description}
                  />
                </dl>
                {data.activities.length > 1 && (
                  <p className="text-ink-500 mt-3 text-xs">
                    {data.activities.length} programme activities are listed in the full request.
                  </p>
                )}
              </SummarySection>

              <SummarySection
                title="Finance & Routing"
                icon={<FileText className="h-4 w-4" aria-hidden="true" />}
              >
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Detail label="Request origin" value={humanize(data.finance.requestOrigin)} />
                  <Detail label="Trip category" value={humanize(data.finance.tripCategory)} />
                  <Detail label="Financial impact" value={humanize(data.finance.financialImpact)} />
                  <Detail
                    label="Estimated cost"
                    value={
                      data.finance.estimatedCost
                        ? `N$ ${Number(data.finance.estimatedCost).toFixed(2)}`
                        : 'No amount recorded'
                    }
                  />
                  <Detail label="Cost centre" value={data.finance.costCentre} />
                  <Detail label="Funding source" value={data.finance.fundingSource} />
                  <Detail label="Budget reference" value={data.finance.budgetReference} />
                </dl>
              </SummarySection>

              <SummarySection
                title="People"
                icon={<Users className="h-4 w-4" aria-hidden="true" />}
              >
                <dl className="mb-3 grid grid-cols-1 gap-3">
                  <Detail
                    label="Requester"
                    value={`${data.requester.name}${data.requester.employeeNumber ? ` · ${data.requester.employeeNumber}` : ''}`}
                  />
                  <Detail
                    label="Department"
                    value={data.requester.department || data.requester.directorate}
                  />
                  <Detail label="Traveller count" value={`${travellerCount}`} />
                  <Detail
                    label="Driver preference"
                    value={humanize(data.logistics.driverPreference)}
                  />
                </dl>
                <PeopleList people={data.passengers} />
                <div className="border-border mt-3 border-t pt-3">
                  <p className="text-ink-500 mb-1 text-xs font-medium">Drivers</p>
                  {data.drivers.length ? (
                    data.drivers.map((driver) => (
                      <p key={driver.id} className="overflow-wrap-anywhere text-ink-950 text-sm">
                        {driver.name} · {humanize(driver.type)} ·{' '}
                        {driver.licenceValidated ? 'Licence validated' : 'Licence pending'}
                      </p>
                    ))
                  ) : (
                    <p className="text-ink-950 text-sm">Not yet assigned</p>
                  )}
                </div>
              </SummarySection>

              <SummarySection
                title="Vehicle & Logistics"
                icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
              >
                <dl className="grid grid-cols-1 gap-3">
                  <Detail label="Requested vehicle" value={data.vehicle.requestedType} />
                  <Detail
                    label="Assigned vehicle"
                    value={data.vehicle.assignedLabel || 'Not yet assigned'}
                  />
                  <Detail label="Terrain" value={data.vehicle.terrain} />
                  <Detail label="Luggage / equipment" value={data.vehicle.luggage} />
                  <Detail label="Fuel / advance" value={data.vehicle.fuelAdvance} />
                  <Detail label="Accommodation" value={data.vehicle.accommodation} />
                  <Detail
                    label="Accessibility / travel needs"
                    value={data.vehicle.accessibilityNeeds || data.logistics.specialRequirements}
                  />
                  <Detail
                    label="Allocation status"
                    value={
                      data.vehicle.allocationState
                        ? humanize(data.vehicle.allocationState)
                        : 'Pending'
                    }
                  />
                </dl>
                {data.logistics.specialAuthorityRequired && (
                  <div className="border-status-pending-bg bg-status-pending-bg/30 mt-3 rounded-[8px] border p-3">
                    <p className="text-status-pending-text text-xs font-semibold">
                      Special authority required
                    </p>
                    <p className="text-ink-700 mt-1 text-xs">
                      {data.logistics.specialAuthorityReason || 'Reason not provided'}
                    </p>
                  </div>
                )}
              </SummarySection>

              <SummarySection
                title="Approval Context"
                icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              >
                <dl className="grid grid-cols-1 gap-3">
                  <Detail label="Completed approvals" value={`${data.actions.length}`} />
                  <Detail
                    label="Required next step"
                    value={data.approvalContext.requiredNextStep}
                  />
                  <Detail
                    label="Requester declaration"
                    value={data.approvalContext.requesterDeclaration}
                  />
                  <Detail label="Attachments" value={`${data.approvalContext.attachmentCount}`} />
                  <Detail
                    label="Driver assignment"
                    value={data.approvalContext.driverAssigned ? 'Assigned' : 'Not yet assigned'}
                  />
                  <Detail
                    label="Vehicle assignment"
                    value={data.approvalContext.vehicleAssigned ? 'Assigned' : 'Not yet assigned'}
                  />
                  <Detail
                    label="Request revision"
                    value={`Revision ${data.approvalContext.revision}`}
                  />
                  <Detail
                    label="Current decision"
                    value={data.currentStepDescription || data.currentStepLabel}
                  />
                </dl>
                {data.approvalContext.changedFields.length > 0 && (
                  <div className="border-border mt-3 border-t pt-3">
                    <p className="text-ink-500 text-xs font-medium">Latest changed fields</p>
                    <p className="overflow-wrap-anywhere text-ink-700 mt-1 text-xs">
                      {data.approvalContext.changedFields.join(', ')}
                    </p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/dashboard/requests/${data.requestId}`}>View full request</Link>
                  </Button>
                  {data.approvalContext.attachmentCount > 0 && (
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={`/dashboard/requests/${data.requestId}#attachments`}>
                        <Paperclip className="h-4 w-4" aria-hidden="true" /> Attachments (
                        {data.approvalContext.attachmentCount})
                      </Link>
                    </Button>
                  )}
                </div>
              </SummarySection>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alerts and Checks</CardTitle>
        </CardHeader>
        <CardContent>
          {data.alerts.length ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {data.alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={cn(
                    'flex min-w-0 items-start gap-3 rounded-[8px] border p-3',
                    alert.tone === 'warning'
                      ? 'border-status-pending-bg bg-status-pending-bg/25'
                      : 'border-status-info-bg bg-status-info-bg/25',
                  )}
                >
                  {alert.tone === 'warning' ? (
                    <AlertTriangle
                      className="text-status-pending-text mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <Info
                      className="text-status-info-text mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-ink-950 text-sm font-semibold">{alert.title}</p>
                    <p className="overflow-wrap-anywhere text-ink-600 mt-1 text-xs">
                      {alert.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="text-status-success-text h-5 w-5 shrink-0"
                aria-hidden="true"
              />
              <div>
                <p className="text-ink-950 text-sm font-medium">No decision warnings identified</p>
                <p className="text-ink-500 mt-1 text-xs">
                  Continue to verify the structured request details before acting.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workflow Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1">
            {data.steps.map((step, index) => {
              const current =
                step.order === data.currentStepOrder && data.workflowStatus === 'active';
              const complete = Boolean(step.action);
              return (
                <li key={step.id} className="flex min-w-0 items-stretch gap-3">
                  <div className="flex w-8 shrink-0 flex-col items-center">
                    <div
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold',
                        complete
                          ? 'border-status-success-bg bg-status-success-bg text-status-success-text'
                          : current
                            ? 'border-brand-600 bg-brand-50 text-brand-800 ring-brand-600/30 ring-2'
                            : 'border-border bg-muted text-ink-500',
                      )}
                    >
                      {complete ? (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      ) : current ? (
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        step.order
                      )}
                    </div>
                    {index < data.steps.length - 1 && (
                      <div
                        className={cn(
                          'my-1 w-px flex-1',
                          complete ? 'bg-status-success-bg' : 'bg-border',
                        )}
                      />
                    )}
                  </div>
                  <div
                    className={cn(
                      'mb-3 min-w-0 flex-1 rounded-[8px] p-3',
                      current
                        ? 'border-brand-200 bg-brand-50/60 dark:border-brand-900 dark:bg-brand-950/25 border'
                        : 'border-border border',
                    )}
                  >
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="overflow-wrap-anywhere text-ink-950 text-sm font-semibold">
                          Step {step.order}: {step.label}
                        </p>
                        {step.description && (
                          <p className="text-ink-500 mt-1 text-xs">{step.description}</p>
                        )}
                      </div>
                      {step.action ? (
                        <Badge variant={statusVariant(step.action.result)} size="sm">
                          {humanize(step.action.result)}
                        </Badge>
                      ) : current ? (
                        <Badge variant="pending" size="sm">
                          Current
                        </Badge>
                      ) : (
                        <Badge variant="default" size="sm">
                          Pending
                        </Badge>
                      )}
                    </div>
                    {step.action && (
                      <div className="text-ink-600 mt-2 text-xs">
                        <p>
                          {step.action.actorName || 'Officer not recorded'}
                          {step.action.acting ? ' · Acting assignment' : ''} ·{' '}
                          {formatDateTime(step.action.createdAt)}
                        </p>
                        {step.action.comment && (
                          <p className="overflow-wrap-anywhere mt-1">{step.action.comment}</p>
                        )}
                      </div>
                    )}
                    {current && (
                      <p className="text-brand-700 mt-2 text-xs font-medium">
                        Awaiting your decision at this stage.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Action History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.actions.length ? (
            <ol className="divide-border divide-y">
              {data.actions.map((action) => (
                <li key={action.id} className="min-w-0 px-4 py-4 sm:px-5">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusVariant(action.result)} size="sm">
                          {humanize(action.result)}
                        </Badge>
                        <span className="text-ink-500 text-xs">
                          Step {action.stepOrder} · {action.stage}
                        </span>
                        {action.acting && (
                          <Badge variant="pending" size="sm">
                            Acting
                          </Badge>
                        )}
                      </div>
                      <p className="overflow-wrap-anywhere text-ink-700 mt-2 text-xs">
                        {action.actorName || action.actorRole}
                      </p>
                    </div>
                    <time className="text-ink-500 shrink-0 text-xs" dateTime={action.createdAt}>
                      {formatDateTime(action.createdAt)}
                    </time>
                  </div>
                  {action.comment && (
                    <details className="mt-2" open={action.comment.length < 180}>
                      <summary className="touch-target text-brand-700 focus-ring inline-flex cursor-pointer text-xs font-medium">
                        Decision comment
                      </summary>
                      <p className="overflow-wrap-anywhere text-ink-700 mt-1 text-sm leading-6">
                        {action.comment}
                      </p>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-ink-500 px-5 py-6 text-sm">
              No approval actions have been recorded yet.
            </p>
          )}
        </CardContent>
      </Card>

      {data.canAct && (
        <MobileApprovalAction href={`/dashboard/approvals/${data.instanceId}/action`} />
      )}
    </div>
  );
}
