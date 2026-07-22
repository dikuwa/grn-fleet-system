/**
 * Request & Trip Status Mapping
 *
 * Maps internal database statuses to user-facing labels, badge variants,
 * and colours. Covers the full transport-request → trip → closure
 * lifecycle as defined in the Business Workflow Specification.
 *
 * Usage:
 *   import { statusConfig } from '@/lib/request-status';
 *   const cfg = statusConfig(request.status);
 *   // cfg.label -> "Supervisor Review", cfg.variant -> "pending", cfg.icon -> ...
 */

// ---------------------------------------------------------------------------
// Transport request statuses (pre-trip / workflow)
// ---------------------------------------------------------------------------

/** Status configuration for a single status code */
export interface StatusConfig {
  /** Short human-readable label */
  label: string;
  /** Badge variant for display */
  variant: 'default' | 'secondary' | 'pending' | 'info' | 'success' | 'error' | 'warning';
  /** Optional detailed description */
  description?: string;
  /** Sort order for status pipelines */
  order: number;
}

/**
 * Full transport request status definitions.
 * Covers the entire workflow from draft → closure.
 */
export const REQUEST_STATUSES: Record<string, StatusConfig> = {
  // --- Pre-submission ---
  draft:       { label: 'Draft',                      variant: 'secondary',  order: 1 },

  // --- Submission & approval pipeline ---
  submitted:       { label: 'Submitted',              variant: 'pending',    order: 2,
    description: 'Awaiting supervisor review' },
  supervisor_review:       { label: 'Supervisor Review',  variant: 'pending',    order: 3,
    description: 'Being reviewed by the immediate supervisor' },
  supervisor_rejected:     { label: 'Supervisor Rejected', variant: 'error',     order: 4,
    description: 'Returned by supervisor — please revise and resubmit' },
  transport_review:        { label: 'Transport Review',   variant: 'pending',    order: 5,
    description: 'Being reviewed by the transport office' },
  vehicle_allocated:       { label: 'Vehicle Allocated',  variant: 'info',      order: 6,
    description: 'A vehicle has been assigned' },
  trip_authority_prepared: { label: 'Trip Authority Prepared', variant: 'info',  order: 7 },

  // --- Release & authorisation ---
  release_pending:              { label: 'Release Pending',             variant: 'pending', order: 8,
    description: 'Awaiting administrative release' },
  administratively_released:    { label: 'Administratively Released',  variant: 'info',    order: 9 },
  final_authorisation_pending:  { label: 'Final Authorisation Pending', variant: 'pending', order: 10 },
  authorised:                   { label: 'Authorised',                  variant: 'success', order: 11,
    description: 'Trip has been fully authorised' },
  driver_acknowledgement_pending: { label: 'Driver Acknowledgment Pending', variant: 'pending', order: 12 },
  ready_for_issue:              { label: 'Ready for Issue',            variant: 'info',    order: 13 },
  vehicle_issued:               { label: 'Vehicle Issued',              variant: 'info',    order: 14,
    description: 'Vehicle has been physically issued to the driver' },

  // --- Trip in progress & return ---
  in_progress:  { label: 'In Progress',               variant: 'pending', order: 15 },
  return_due:   { label: 'Return Due',                variant: 'warning', order: 16,
    description: 'Trip should have been returned' },
  return_inspection:  { label: 'Return Inspection',   variant: 'pending', order: 17,
    description: 'Awaiting return inspection' },
  closure_review:     { label: 'Closure Review',      variant: 'pending', order: 18,
    description: 'Being reviewed for closure' },
  closed:       { label: 'Closed',                    variant: 'secondary', order: 19,
    description: 'Trip has been completed and closed' },
  cancelled:    { label: 'Cancelled',                 variant: 'error',    order: 20 },

  // --- Fallback / legacy ---
  rejected:     { label: 'Rejected',                  variant: 'error',    order: 21, description: 'Request has been rejected' },
  returned:     { label: 'Returned for Revision',     variant: 'warning',  order: 4.5,
    description: 'Request has been returned for corrections' },
  approved:     { label: 'Approved',                  variant: 'success',  order: 11,
    description: 'Request has been approved' },
};

// ---------------------------------------------------------------------------
// Trip statuses (operational)
// ---------------------------------------------------------------------------

export const TRIP_STATUSES: Record<string, StatusConfig> = {
  pending:             { label: 'Pending',             variant: 'secondary', order: 1 },
  in_progress:        { label: 'In Progress',          variant: 'pending',  order: 2 },
  return_due:         { label: 'Return Due',           variant: 'warning',  order: 3 },
  return_inspection:  { label: 'Return Inspection',    variant: 'pending',  order: 4 },
  closure_review:     { label: 'Closure Review',       variant: 'pending',  order: 5 },
  closed:             { label: 'Closed',               variant: 'success',  order: 6 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the status configuration for a request or trip status code.
 * Falls back gracefully for unknown statuses.
 */
export function statusConfig(status: string | null | undefined): StatusConfig {
  if (!status) return { label: 'Unknown', variant: 'secondary', order: 999 };
  return REQUEST_STATUSES[status] ?? TRIP_STATUSES[status] ?? { label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), variant: 'secondary', order: 999 };
}

/**
 * Map a workflow step number + action type to a business status name.
 *
 * Regional (5 steps):
 *   1: supervisor_approve   → supervisor_review
 *   2: transport_review    → transport_review
 *   3: release              → release_pending
 *   4: authorise            → administratively_released
 *   5: acknowledge          → driver_acknowledgement_pending
 *
 * National (6 steps):
 *   1: supervisor_approve   → supervisor_review
 *   2: transport_review    → transport_review
 *   3: release (regional)   → vehicle_allocated
 *   4: release (national)   → administratively_released
 *   5: authorise            → final_authorisation_pending
 *   6: acknowledge          → driver_acknowledgement_pending
 */
export function workflowStepToStatus(
  stepOrder: number,
  actionType: string,
  _scope: 'regional' | 'national' = 'regional',
): string {
  const REGIONAL_MAP: Record<number, string> = {
    1: 'supervisor_review',
    2: 'transport_review',
    3: 'release_pending',
    4: 'administratively_released',
    5: 'driver_acknowledgement_pending',
  };
  const NATIONAL_MAP: Record<number, string> = {
    1: 'supervisor_review',
    2: 'transport_review',
    3: 'vehicle_allocated',
    4: 'administratively_released',
    5: 'final_authorisation_pending',
    6: 'driver_acknowledgement_pending',
  };
  return (_scope === 'national' ? NATIONAL_MAP[stepOrder] : REGIONAL_MAP[stepOrder])
    ?? `step_${stepOrder}`;
}

/**
 * Get the next trip status when a workflow completes (all steps approved).
 */
export function workflowCompletedStatus(): string {
  return 'authorised';
}

/**
 * Get the trip status when a request is issued to the driver.
 */
export function vehicleIssuedStatus(): string {
  return 'vehicle_issued';
}

/**
 * Get CSS colour for a status variant (for non-Badge use, e.g. icons).
 */
export function statusColour(variant: StatusConfig['variant']): string {
  switch (variant) {
    case 'success': return '#065F46';
    case 'error':   return '#991B1B';
    case 'warning': return '#92400E';
    case 'pending': return '#1E40AF';
    case 'info':    return '#1F4E8C';
    default:        return '#4B5563';
  }
}
