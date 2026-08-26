export type ApprovalRouteSummary = {
  originName?: string | null;
  destinationName?: string | null;
  mappedDistanceKm?: number | null;
  mappedDurationMinutes?: number | null;
  totalKilometres?: number | null;
  overrideReason?: string | null;
  calculationTimestamp?: string | null;
};

export type ApprovalAlert = {
  id: string;
  tone: 'warning' | 'info';
  title: string;
  detail: string;
};

export type ApprovalAlertInput = {
  scope?: string | null;
  specialAuthorityRequired: boolean;
  specialAuthorityReason?: string | null;
  attachmentCount: number;
  travellerCount: number;
  requesterIsPassenger: boolean;
  routes: ApprovalRouteSummary[];
  departureAt?: string | null;
  driverAssigned: boolean;
  hasDriverWithUnvalidatedLicence: boolean;
  vehicleAssigned: boolean;
  vehicleCapacity?: number | null;
  requestUpdatedAt?: string | null;
  latestApprovalAt?: string | null;
  revision: number;
  hasActingApproval: boolean;
};

export type ApprovalBriefInput = {
  travellerCount: number;
  origin?: string | null;
  destination?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  purpose?: string | null;
  finance?: {
    requestOrigin: string;
    financialImpact: string;
    tripCategory: string;
    estimatedCost?: string | null;
    currency: string;
    costCentre?: string | null;
    fundingSource?: string | null;
    budgetReference?: string | null;
  };
  vehicleType?: string | null;
  driverAssigned: boolean;
  specialAuthorityRequired: boolean;
  currentStage: string;
};

function clean(value?: string | null) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function shorten(value?: string | null, max = 72) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (normalized.length <= max) return normalized;
  const slice = normalized.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const end = lastSpace > max * 0.6 ? lastSpace : slice.length;
  return `${slice.slice(0, end)}…`;
}

export function buildApprovalRequestTitle(input: {
  purpose?: string | null;
  routes?: readonly ApprovalRouteSummary[];
}) {
  const purpose = shorten(input.purpose);
  const routes = input.routes ?? [];
  const firstOrigin = clean(routes[0]?.originName);
  const lastDestination = clean(routes.at(-1)?.destinationName);
  const routeLabel =
    firstOrigin && lastDestination
      ? firstOrigin.toLocaleLowerCase() === lastDestination.toLocaleLowerCase()
        ? lastDestination
        : `${firstOrigin} to ${lastDestination}`
      : lastDestination || firstOrigin;

  if (routeLabel && purpose) return `${routeLabel} — ${purpose}`;
  return routeLabel || purpose || 'Transport Request';
}

export function buildStructuredDecisionBrief(input: ApprovalBriefInput, locale = 'en-NA') {
  const formatDate = (value?: string | null) => {
    if (!value) return 'Not provided';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not provided';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
  };
  const origin = clean(input.origin) || 'Not provided';
  const destination = clean(input.destination) || 'Not provided';
  const purpose = clean(input.purpose) || 'Not provided';
  const vehicle = clean(input.vehicleType) || 'Not provided';
  const driver = input.driverAssigned ? 'Assigned' : 'Not yet assigned';
  const authority = input.specialAuthorityRequired ? 'Required' : 'Not required';
  const finance = input.finance
    ? ` Request origin: ${input.finance.requestOrigin.replace(/_/g, ' ')}. Financial impact: ${input.finance.financialImpact.replace(/_/g, ' ')}${input.finance.estimatedCost ? ` (${input.finance.currency} ${input.finance.estimatedCost})` : ''}.`
    : '';

  return `${input.travellerCount} traveller${input.travellerCount === 1 ? '' : 's'} will travel from ${origin} to ${destination} from ${formatDate(input.startAt)} to ${formatDate(input.endAt)} for ${purpose}. Requested vehicle: ${vehicle}. Driver: ${driver}. Special authority: ${authority}.${finance} Current decision: ${input.currentStage}.`;
}

export function getApprovalPrimaryAction(actionType?: string | null) {
  switch (actionType) {
    case 'release':
      return { label: 'Release', past: 'released' };
    case 'authorise':
      return { label: 'Authorise', past: 'authorised' };
    case 'acknowledge':
      return { label: 'Acknowledge', past: 'acknowledged' };
    case 'transport_review':
      return { label: 'Complete Review', past: 'reviewed' };
    case 'finance_review':
      return { label: 'Confirm Budget Review', past: 'budget reviewed' };
    case 'organisational_approve':
      return { label: 'Approve as Director / Sponsor', past: 'organisationally approved' };
    default:
      return { label: 'Approve', past: 'approved' };
  }
}

export function isApprovalCommentRequired(result: string, stepRequiresComment: boolean) {
  return stepRequiresComment || result === 'rejected' || result === 'returned';
}

export function buildApprovalAlerts(input: ApprovalAlertInput, now = new Date()) {
  const alerts: ApprovalAlert[] = [];
  if (input.specialAuthorityRequired) {
    alerts.push({
      id: 'special-authority',
      tone: 'warning',
      title: 'Special authority required',
      detail: clean(input.specialAuthorityReason) || 'No supporting reason was provided.',
    });
    if (input.attachmentCount === 0) {
      alerts.push({
        id: 'special-authority-evidence',
        tone: 'warning',
        title: 'No supporting attachment',
        detail: 'This special-authority request has no supporting attachment on record.',
      });
    }
  }
  if (input.scope === 'national') {
    alerts.push({
      id: 'national-scope',
      tone: 'info',
      title: 'National approval path',
      detail: 'This trip follows the higher national release and authorisation path.',
    });
  }
  if (!input.driverAssigned) {
    alerts.push({
      id: 'driver-unassigned',
      tone: 'warning',
      title: 'Driver not yet assigned',
      detail: 'A confirmed driver must be assigned before final trip authorisation.',
    });
  }
  if (!input.vehicleAssigned) {
    alerts.push({
      id: 'vehicle-unassigned',
      tone: 'warning',
      title: 'Vehicle not yet assigned',
      detail: 'Vehicle allocation is still pending.',
    });
  }
  if (!input.routes.length || input.routes.every((route) => !route.mappedDistanceKm)) {
    alerts.push({
      id: 'distance-missing',
      tone: 'warning',
      title: 'Route distance unavailable',
      detail: 'No mapped route distance is available; verify the journey details before deciding.',
    });
  }
  if (input.routes.some((route) => clean(route.overrideReason))) {
    alerts.push({
      id: 'distance-overridden',
      tone: 'info',
      title: 'Route distance manually adjusted',
      detail: 'At least one journey leg contains a manual distance override and recorded reason.',
    });
  }
  if (input.departureAt) {
    const departure = new Date(input.departureAt);
    if (!Number.isNaN(departure.getTime())) {
      const hours = (departure.getTime() - now.getTime()) / 3_600_000;
      if (hours < 0) {
        alerts.push({
          id: 'departure-overdue',
          tone: 'warning',
          title: 'Planned departure has passed',
          detail: 'Confirm that the dates are still valid before completing this approval.',
        });
      } else if (hours <= 24) {
        alerts.push({
          id: 'departure-near',
          tone: 'warning',
          title: 'Departure is within 24 hours',
          detail: 'The remaining allocation and approval steps may be time-sensitive.',
        });
      }
    }
  }
  if (
    input.vehicleAssigned &&
    input.vehicleCapacity &&
    input.travellerCount > input.vehicleCapacity
  ) {
    alerts.push({
      id: 'capacity-risk',
      tone: 'warning',
      title: 'Possible vehicle capacity conflict',
      detail: `${input.travellerCount} travellers are listed for a vehicle with ${input.vehicleCapacity} seats.`,
    });
  }
  if (input.requesterIsPassenger) {
    alerts.push({
      id: 'requester-travelling',
      tone: 'info',
      title: 'Requester is travelling',
      detail: 'The requester also appears in the passenger manifest.',
    });
  }
  if (input.hasDriverWithUnvalidatedLicence) {
    alerts.push({
      id: 'licence-pending',
      tone: 'warning',
      title: 'Driver licence validation pending',
      detail: 'At least one nominated or assigned driver has not completed licence validation.',
    });
  }
  if (
    input.revision > 1 &&
    input.requestUpdatedAt &&
    input.latestApprovalAt &&
    new Date(input.requestUpdatedAt) > new Date(input.latestApprovalAt)
  ) {
    alerts.push({
      id: 'changed-after-approval',
      tone: 'warning',
      title: 'Request updated after a prior approval',
      detail: `You are reviewing revision ${input.revision}. Inspect the latest request details and revision history.`,
    });
  }
  if (input.hasActingApproval) {
    alerts.push({
      id: 'acting-history',
      tone: 'info',
      title: 'Acting or delegated approval recorded',
      detail: 'At least one earlier decision was completed under an acting assignment.',
    });
  }
  return alerts;
}
