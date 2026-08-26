/**
 * Request & Trip Status Mapping
 *
 * Maps internal database statuses to user-facing labels, badge variants,
 * and colours. Covers the full transport-request → trip → closure lifecycle.
 */

export interface StatusConfig {
  label: string;
  variant: 'default' | 'secondary' | 'pending' | 'info' | 'success' | 'error' | 'warning';
  description?: string;
  order: number;
}

export const REQUEST_STATUSES: Record<string, StatusConfig> = {
  draft: { label: 'Draft', variant: 'secondary', order: 1 },
  submitted: {
    label: 'Submitted',
    variant: 'pending',
    order: 2,
    description: 'Awaiting the first configured approval or review stage',
  },
  supervisor_review: { label: 'Supervisor Review', variant: 'pending', order: 3, description: 'Being reviewed by the immediate supervisor' },
  organisational_review: { label: 'Director / Sponsor Approval', variant: 'pending', order: 3.2, description: 'Awaiting the responsible organisational authority' },
  finance_review: { label: 'Finance / Budget Review', variant: 'pending', order: 3.4, description: 'Funding and budget impact are being reviewed' },
  supervisor_rejected: { label: 'Supervisor Rejected', variant: 'error', order: 4, description: 'Returned by supervisor — please revise and resubmit' },
  transport_review: { label: 'Transport Review', variant: 'pending', order: 5, description: 'Being reviewed by the transport office' },
  vehicle_allocated: { label: 'Vehicle Allocated', variant: 'info', order: 6, description: 'A vehicle has been assigned' },
  trip_authority_prepared: { label: 'Trip Authority Prepared', variant: 'info', order: 7 },
  release_pending: { label: 'Release Pending', variant: 'pending', order: 8, description: 'Awaiting administrative release' },
  administratively_released: { label: 'Administratively Released', variant: 'info', order: 9 },
  final_authorisation_pending: { label: 'Final Authorisation Pending', variant: 'pending', order: 10 },
  authorised: { label: 'Authorised', variant: 'success', order: 11, description: 'Trip has been fully authorised' },
  driver_acknowledgement_pending: { label: 'Driver Acknowledgment Pending', variant: 'pending', order: 12 },
  ready_for_issue: { label: 'Ready for Issue', variant: 'info', order: 13 },
  vehicle_issued: { label: 'Vehicle Issued', variant: 'info', order: 14, description: 'Vehicle has been physically issued to the driver' },
  in_progress: { label: 'In Progress', variant: 'pending', order: 15 },
  return_due: { label: 'Return Due', variant: 'warning', order: 16, description: 'Trip should have been returned' },
  return_inspection: { label: 'Return Inspection', variant: 'pending', order: 17, description: 'Awaiting return inspection' },
  closure_review: { label: 'Closure Review', variant: 'pending', order: 18, description: 'Being reviewed for closure' },
  closed: { label: 'Closed', variant: 'secondary', order: 19, description: 'Trip has been completed and closed' },
  cancelled: { label: 'Cancelled', variant: 'error', order: 20 },
  rejected: { label: 'Rejected', variant: 'error', order: 21, description: 'Request has been rejected' },
  returned: { label: 'Returned for Revision', variant: 'warning', order: 4.5, description: 'Request has been returned for corrections' },
  approved: { label: 'Approved', variant: 'success', order: 11, description: 'Request has been approved' },
};

export const REQUEST_STATUS_GROUPS = {
  pendingApproval: [
    'submitted',
    'supervisor_review',
    'organisational_review',
    'finance_review',
    'transport_review',
    'release_pending',
    'final_authorisation_pending',
    'driver_acknowledgement_pending',
  ],
  active: [
    'vehicle_allocated',
    'trip_authority_prepared',
    'administratively_released',
    'authorised',
    'approved',
    'ready_for_issue',
    'vehicle_issued',
    'in_progress',
    'return_due',
    'return_inspection',
    'closure_review',
  ],
  closed: ['closed'],
  cancelled: ['cancelled'],
} as const;

export const TRIP_STATUSES: Record<string, StatusConfig> = {
  pending: { label: 'Pending', variant: 'secondary', order: 1 },
  in_progress: { label: 'In Progress', variant: 'pending', order: 2 },
  return_due: { label: 'Return Due', variant: 'warning', order: 3 },
  return_inspection: { label: 'Return Inspection', variant: 'pending', order: 4 },
  closure_review: { label: 'Closure Review', variant: 'pending', order: 5 },
  closed: { label: 'Closed', variant: 'success', order: 6 },
  cancelled: { label: 'Cancelled', variant: 'error', order: 7 },
};

export const TRIP_STATUS_GROUPS = {
  active: ['pending', 'in_progress'],
  returnDue: ['return_due'],
  closed: ['closed'],
  cancelled: ['cancelled'],
} as const;

export function statusConfig(status: string | null | undefined): StatusConfig {
  if (!status) return { label: 'Unknown', variant: 'secondary', order: 999 };
  return (
    REQUEST_STATUSES[status] ??
    TRIP_STATUSES[status] ?? {
      label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      variant: 'secondary',
      order: 999,
    }
  );
}

/**
 * Translate the workflow stage being entered into the request business status.
 *
 * Action type is the source of truth. Older code keyed primarily by step order,
 * which made the status model drift whenever a tenant workflow inserted or
 * removed a stage (the national fallback previously had six steps while the
 * seeded definition has five). Keeping a small order fallback preserves
 * compatibility with legacy definitions that omitted a recognised actionType.
 */
export function workflowStepToStatus(
  stepOrder: number,
  actionType: string,
  scope: 'regional' | 'national' = 'regional',
): string {
  const BY_ACTION: Record<string, string> = {
    supervisor_approve: 'supervisor_review',
    organisational_approve: 'organisational_review',
    finance_review: 'finance_review',
    transport_review: 'transport_review',
    release: 'release_pending',
    authorise: 'final_authorisation_pending',
    acknowledge: 'driver_acknowledgement_pending',
  };
  if (BY_ACTION[actionType]) return BY_ACTION[actionType];

  const LEGACY_REGIONAL_MAP: Record<number, string> = {
    1: 'supervisor_review',
    2: 'transport_review',
    3: 'release_pending',
    4: 'final_authorisation_pending',
    5: 'driver_acknowledgement_pending',
  };
  const LEGACY_NATIONAL_MAP: Record<number, string> = {
    1: 'supervisor_review',
    2: 'transport_review',
    3: 'release_pending',
    4: 'final_authorisation_pending',
    5: 'driver_acknowledgement_pending',
    6: 'driver_acknowledgement_pending',
  };
  return (scope === 'national' ? LEGACY_NATIONAL_MAP[stepOrder] : LEGACY_REGIONAL_MAP[stepOrder]) ?? `step_${stepOrder}`;
}

export function workflowCompletedStatus(): string {
  return 'authorised';
}

export function vehicleIssuedStatus(): string {
  return 'vehicle_issued';
}

export function statusColour(variant: StatusConfig['variant']): string {
  switch (variant) {
    case 'success': return '#065F46';
    case 'error': return '#991B1B';
    case 'warning': return '#92400E';
    case 'pending': return '#1E40AF';
    case 'info': return '#1F4E8C';
    default: return '#4B5563';
  }
}