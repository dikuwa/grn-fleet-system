/**
 * Request & Trip Status Mapping
 *
 * Maps internal database statuses to user-facing labels, badge variants,
 * and colours. Covers the full transport-request → trip → closure lifecycle.
 *
 * Workflow definitions are tenant-configurable. Business status therefore
 * follows the configured step action, never a hard-coded regional/national
 * step number.
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

/** Full transport request status definitions. */
export const REQUEST_STATUSES: Record<string, StatusConfig> = {
  draft: { label: 'Draft', variant: 'secondary', order: 1 },
  submitted: {
    label: 'Submitted',
    variant: 'pending',
    order: 2,
    description: 'Awaiting the first configured review or approval step',
  },
  supervisor_review: {
    label: 'Supervisor Review',
    variant: 'pending',
    order: 3,
    description: 'Being reviewed by the immediate supervisor',
  },
  supervisor_rejected: {
    label: 'Supervisor Rejected',
    variant: 'error',
    order: 4,
    description: 'Returned by supervisor — please revise and resubmit',
  },
  transport_review: {
    label: 'Transport Review',
    variant: 'pending',
    order: 5,
    description: 'Operational review by the transport office before allocation/release',
  },
  vehicle_allocated: {
    label: 'Vehicle Allocated',
    variant: 'info',
    order: 6,
    description: 'A vehicle has been assigned',
  },
  trip_authority_prepared: { label: 'Trip Authority Prepared', variant: 'info', order: 7 },
  release_pending: {
    label: 'Release Pending',
    variant: 'pending',
    order: 8,
    description: 'Awaiting the configured administrative release action',
  },
  administratively_released: { label: 'Administratively Released', variant: 'info', order: 9 },
  final_authorisation_pending: {
    label: 'Final Authorisation Pending',
    variant: 'pending',
    order: 10,
  },
  authorised: {
    label: 'Authorised',
    variant: 'success',
    order: 11,
    description: 'Configured workflow has completed successfully',
  },
  driver_acknowledgement_pending: {
    label: 'Driver Acknowledgment Pending',
    variant: 'pending',
    order: 12,
  },
  ready_for_issue: { label: 'Ready for Issue', variant: 'info', order: 13 },
  vehicle_issued: {
    label: 'Vehicle Issued',
    variant: 'info',
    order: 14,
    description: 'Vehicle has been physically issued to the driver',
  },
  in_progress: { label: 'In Progress', variant: 'pending', order: 15 },
  return_due: {
    label: 'Return Due',
    variant: 'warning',
    order: 16,
    description: 'Trip should have been returned',
  },
  return_inspection: {
    label: 'Return Inspection',
    variant: 'pending',
    order: 17,
    description: 'Awaiting return inspection',
  },
  closure_review: {
    label: 'Closure Review',
    variant: 'pending',
    order: 18,
    description: 'Being reviewed for closure',
  },
  closed: {
    label: 'Closed',
    variant: 'secondary',
    order: 19,
    description: 'Trip has been completed and closed',
  },
  cancelled: { label: 'Cancelled', variant: 'error', order: 20 },
  rejected: {
    label: 'Rejected',
    variant: 'error',
    order: 21,
    description: 'Request has been rejected',
  },
  returned: {
    label: 'Returned for Revision',
    variant: 'warning',
    order: 4.5,
    description: 'Request has been returned for corrections',
  },
  approved: {
    label: 'Approved',
    variant: 'success',
    order: 11,
    description: 'Request has been approved',
  },
};

export const REQUEST_STATUS_GROUPS = {
  // Decision/approval work only. Operational transport review and driver
  // acknowledgement are deliberately not counted as approvals.
  pendingApproval: [
    'submitted',
    'supervisor_review',
    'release_pending',
    'final_authorisation_pending',
  ],
  active: [
    'transport_review',
    'vehicle_allocated',
    'trip_authority_prepared',
    'administratively_released',
    'authorised',
    'approved',
    'driver_acknowledgement_pending',
    'ready_for_issue',
    'vehicle_issued',
    'in_progress',
    'return_due',
    'return_inspection',
    'closure_review',
  ],
  closed: ['closed'],
} as const;

// ---------------------------------------------------------------------------
// Trip statuses (operational)
// ---------------------------------------------------------------------------

export const TRIP_STATUSES: Record<string, StatusConfig> = {
  pending: { label: 'Pending', variant: 'secondary', order: 1 },
  in_progress: { label: 'In Progress', variant: 'pending', order: 2 },
  return_due: { label: 'Return Due', variant: 'warning', order: 3 },
  return_inspection: { label: 'Return Inspection', variant: 'pending', order: 4 },
  closure_review: { label: 'Closure Review', variant: 'pending', order: 5 },
  closed: { label: 'Closed', variant: 'success', order: 6 },
};

export const TRIP_STATUS_GROUPS = {
  active: ['pending', 'in_progress'],
  returnDue: ['return_due'],
  closed: ['closed'],
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Convert the configured workflow step being entered into a business status.
 *
 * `stepOrder` and `scope` remain in the signature for compatibility with
 * existing callers, but neither controls the mapping. This is intentional:
 * tenants may insert/remove/reorder workflow steps without changing business
 * status semantics.
 */
export function workflowStepToStatus(
  stepOrder: number,
  actionType: string,
  _scope: 'regional' | 'national' = 'regional',
): string {
  const STATUS_BY_ACTION: Record<string, string> = {
    supervisor_approve: 'supervisor_review',
    transport_review: 'transport_review',
    release: 'release_pending',
    authorise: 'final_authorisation_pending',
    acknowledge: 'driver_acknowledgement_pending',
  };

  return STATUS_BY_ACTION[actionType] ?? `step_${stepOrder}`;
}

/** Request status after all configured workflow steps complete. */
export function workflowCompletedStatus(): string {
  return 'authorised';
}

/** Request status when the vehicle is physically issued to the driver. */
export function vehicleIssuedStatus(): string {
  return 'vehicle_issued';
}

/** Get CSS colour for a status variant (for non-Badge use, e.g. icons). */
export function statusColour(variant: StatusConfig['variant']): string {
  switch (variant) {
    case 'success':
      return '#065F46';
    case 'error':
      return '#991B1B';
    case 'warning':
      return '#92400E';
    case 'pending':
      return '#1E40AF';
    case 'info':
      return '#1F4E8C';
    default:
      return '#4B5563';
  }
}
