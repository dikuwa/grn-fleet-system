/**
 * Centralised Status Icon Configuration
 *
 * Provides a single source of truth for mapping status codes to
 * Lucide React icons, labels, and colours. Used consistently across
 * trip lists, dashboards, notifications, reports, and approvals.
 *
 * This eliminates scattered emoji, inline SVG, or colour-only status
 * indicators throughout the application.
 */

import {
  CirclePlay,
  Navigation,
  Activity,
  ClockAlert,
  ClipboardCheck,
  SearchCheck,
  FileSearch,
  ClipboardList,
  CircleCheck,
  Clock3,
  Hourglass,
  CircleX,
  CircleMinus,
  BadgeCheck,
  Ban,
  FileEdit,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';

export interface StatusIconConfig {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Human-readable label */
  label: string;
  /** Badge variant for colour coding */
  variant: 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency' | 'default';
  /** Accessible description */
  description: string;
}

/**
 * Transport request status icon mapping.
 * Covers the full request lifecycle from draft through to closure.
 */
export const REQUEST_STATUS_ICONS: Record<string, StatusIconConfig> = {
  // Pre-submission
  draft: { icon: FileEdit, label: 'Draft', variant: 'default', description: 'Request is being prepared' },

  // Submission & approval pipeline
  submitted: { icon: Clock3, label: 'Submitted', variant: 'pending', description: 'Awaiting supervisor review' },
  supervisor_review: { icon: SearchCheck, label: 'Supervisor Review', variant: 'pending', description: 'Being reviewed by supervisor' },
  supervisor_rejected: { icon: CircleX, label: 'Rejected', variant: 'error', description: 'Returned by supervisor for revision' },
  transport_review: { icon: ClipboardCheck, label: 'Transport Review', variant: 'pending', description: 'Being reviewed by transport office' },
  vehicle_allocated: { icon: Navigation, label: 'Vehicle Allocated', variant: 'info', description: 'Vehicle has been assigned' },
  trip_authority_prepared: { icon: ClipboardList, label: 'Trip Authority Prepared', variant: 'info', description: 'Trip authority document ready' },

  // Release & authorisation
  release_pending: { icon: Hourglass, label: 'Release Pending', variant: 'pending', description: 'Awaiting administrative release' },
  administratively_released: { icon: BadgeCheck, label: 'Administratively Released', variant: 'info', description: 'Administrative release completed' },
  final_authorisation_pending: { icon: Clock3, label: 'Final Authorisation Pending', variant: 'pending', description: 'Awaiting final authorisation' },
  authorised: { icon: BadgeCheck, label: 'Authorised', variant: 'success', description: 'Trip has been fully authorised' },
  driver_acknowledgement_pending: { icon: Clock3, label: 'Driver Acknowledgment', variant: 'pending', description: 'Awaiting driver acknowledgment' },
  ready_for_issue: { icon: CircleCheck, label: 'Ready for Issue', variant: 'info', description: 'Ready for vehicle issue' },
  vehicle_issued: { icon: Play, label: 'Vehicle Issued', variant: 'info', description: 'Vehicle has been issued to driver' },

  // Trip in progress & return
  in_progress: { icon: CirclePlay, label: 'In Progress', variant: 'info', description: 'Trip is currently in progress' },
  return_due: { icon: ClockAlert, label: 'Return Due', variant: 'emergency', description: 'Trip should have been returned' },
  return_inspection: { icon: ClipboardCheck, label: 'Return Inspection', variant: 'pending', description: 'Awaiting return inspection' },
  closure_review: { icon: FileSearch, label: 'Closure Review', variant: 'pending', description: 'Being reviewed for closure' },
  closed: { icon: CircleCheck, label: 'Closed', variant: 'success', description: 'Trip has been completed and closed' },
  cancelled: { icon: CircleX, label: 'Cancelled', variant: 'cancelled', description: 'Request has been cancelled' },

  // Legacy / fallback
  rejected: { icon: Ban, label: 'Rejected', variant: 'error', description: 'Request has been rejected' },
  returned: { icon: RotateCcw, label: 'Returned for Revision', variant: 'pending', description: 'Request returned for corrections' },
  approved: { icon: CheckCircle2, label: 'Approved', variant: 'success', description: 'Request has been approved' },
};

/**
 * Operational trip status icon mapping.
 */
export const TRIP_STATUS_ICONS: Record<string, StatusIconConfig> = {
  pending: { icon: Hourglass, label: 'Pending', variant: 'default', description: 'Trip has not started' },
  in_progress: { icon: CirclePlay, label: 'In Progress', variant: 'info', description: 'Trip is in progress' },
  return_due: { icon: ClockAlert, label: 'Return Due', variant: 'emergency', description: 'Trip should have been returned' },
  return_inspection: { icon: ClipboardCheck, label: 'Return Inspection', variant: 'pending', description: 'Awaiting return inspection' },
  closure_review: { icon: FileSearch, label: 'Closure Review', variant: 'pending', description: 'Being reviewed for closure' },
  closed: { icon: CircleCheck, label: 'Closed', variant: 'success', description: 'Trip is completed and closed' },
};

/**
 * Allocation state icon mapping.
 */
export const ALLOCATION_STATE_ICONS: Record<string, StatusIconConfig> = {
  provisional: { icon: Hourglass, label: 'Provisional', variant: 'pending', description: 'Allocation is provisional' },
  confirmed: { icon: BadgeCheck, label: 'Confirmed', variant: 'info', description: 'Allocation has been confirmed' },
  cancelled: { icon: CircleX, label: 'Cancelled', variant: 'cancelled', description: 'Allocation has been cancelled' },
  released: { icon: CheckCircle2, label: 'Released', variant: 'success', description: 'Allocation has been released' },
};

/**
 * Reimbursement state icon mapping.
 */
export const REIMBURSEMENT_STATE_ICONS: Record<string, StatusIconConfig> = {
  pending: { icon: Clock3, label: 'Pending', variant: 'pending', description: 'Claim is pending review' },
  approved: { icon: BadgeCheck, label: 'Approved', variant: 'info', description: 'Claim has been approved' },
  paid: { icon: CheckCircle2, label: 'Paid', variant: 'success', description: 'Claim has been paid' },
  rejected: { icon: CircleX, label: 'Rejected', variant: 'error', description: 'Claim has been rejected' },
};

/**
 * Workflow status icon mapping.
 */
export const WORKFLOW_STATUS_ICONS: Record<string, StatusIconConfig> = {
  active: { icon: ClipboardCheck, label: 'Active', variant: 'info', description: 'Workflow is active and awaiting action' },
  completed: { icon: CheckCircle2, label: 'Completed', variant: 'success', description: 'Workflow has been completed' },
  cancelled: { icon: CircleX, label: 'Cancelled', variant: 'cancelled', description: 'Workflow has been cancelled' },
  overridden: { icon: AlertCircle, label: 'Overridden', variant: 'emergency', description: 'Workflow decision was overridden' },
};

/**
 * Inspection status icon mapping.
 */
export const INSPECTION_STATUS_ICONS: Record<string, StatusIconConfig> = {
  in_progress: { icon: ClipboardCheck, label: 'In Progress', variant: 'pending', description: 'Inspection is in progress' },
  completed: { icon: CheckCircle2, label: 'Completed', variant: 'success', description: 'Inspection has been completed' },
  failed: { icon: XCircle, label: 'Failed', variant: 'error', description: 'Inspection failed' },
};

/**
 * Employment status icon mapping.
 */
export const EMPLOYMENT_STATUS_ICONS: Record<string, StatusIconConfig> = {
  active: { icon: CheckCircle2, label: 'Active', variant: 'success', description: 'Employee is active' },
  suspended: { icon: ClockAlert, label: 'Suspended', variant: 'pending', description: 'Employee is suspended' },
  terminated: { icon: XCircle, label: 'Terminated', variant: 'error', description: 'Employee has been terminated' },
};

/**
 * Get the status icon config for a request or trip status code.
 * Falls back gracefully for unknown statuses.
 */
export function getStatusIconConfig(status: string | null | undefined): StatusIconConfig {
  if (!status) return { icon: Clock3, label: 'Unknown', variant: 'default', description: 'Status not available' };

  return REQUEST_STATUS_ICONS[status]
    ?? TRIP_STATUS_ICONS[status]
    ?? ALLOCATION_STATE_ICONS[status]
    ?? REIMBURSEMENT_STATE_ICONS[status]
    ?? WORKFLOW_STATUS_ICONS[status]
    ?? INSPECTION_STATUS_ICONS[status]
    ?? EMPLOYMENT_STATUS_ICONS[status]
    ?? {
      icon: Clock3,
      label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      variant: 'default',
      description: status.replace(/_/g, ' '),
    };
}

/**
 * Get the Lucide icon for a status code.
 */
export function getStatusIcon(status: string | null | undefined): LucideIcon {
  return getStatusIconConfig(status).icon;
}
