export const APP_NAME = 'GovFleet Namibia';
export const APP_SHORT_NAME = 'GovFleet';
export const APP_DESCRIPTION = 'Namibia Government Fleet Management System';

export const SIDEBAR_EXPANDED_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
export const TOPBAR_HEIGHT = 64;
export const MAX_CONTENT_WIDTH = 1440;
export const LANDING_CONTENT_WIDTH = 1200;

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const UPLOAD_MAX_SIZE_MB = 10;
export const UPLOAD_MAX_SIZE_BYTES = UPLOAD_MAX_SIZE_MB * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

export const SHARE_LINK_EXPIRY_OPTIONS = [
  { label: '24 hours', value: 24 * 60 * 60 * 1000 },
  { label: '7 days', value: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', value: 30 * 24 * 60 * 60 * 1000 },
] as const;

export const REMINDER_DEFAULT_HOURS = 2;
export const ESCALATION_DEFAULT_HOURS = 4;

export const TRIP_SCOPES = ['regional', 'national'] as const;
export type TripScope = (typeof TRIP_SCOPES)[number];

export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'supervisor_review',
  'supervisor_rejected',
  'transport_review',
  'vehicle_allocated',
  'trip_authority_prepared',
  'release_pending',
  'administratively_released',
  'final_authorisation_pending',
  'authorised',
  'driver_acknowledgement_pending',
  'ready_for_issue',
  'vehicle_issued',
  'in_progress',
  'return_due',
  'return_inspection',
  'closure_review',
  'closed',
  'cancelled',
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  supervisor_review: 'Supervisor Review',
  supervisor_rejected: 'Supervisor Rejected',
  transport_review: 'Transport Review',
  vehicle_allocated: 'Vehicle Allocated',
  trip_authority_prepared: 'Trip Authority Prepared',
  release_pending: 'Release Pending',
  administratively_released: 'Administratively Released',
  final_authorisation_pending: 'Final Authorisation Pending',
  authorised: 'Authorised',
  driver_acknowledgement_pending: 'Driver Acknowledgement Pending',
  ready_for_issue: 'Ready for Issue',
  vehicle_issued: 'Vehicle Issued',
  in_progress: 'In Progress',
  return_due: 'Return Due',
  return_inspection: 'Return Inspection',
  closure_review: 'Closure Review',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const STATUS_VARIANTS: Record<
  RequestStatus,
  'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'
> = {
  draft: 'pending',
  submitted: 'info',
  supervisor_review: 'pending',
  supervisor_rejected: 'error',
  transport_review: 'info',
  vehicle_allocated: 'info',
  trip_authority_prepared: 'info',
  release_pending: 'pending',
  administratively_released: 'info',
  final_authorisation_pending: 'pending',
  authorised: 'success',
  driver_acknowledgement_pending: 'pending',
  ready_for_issue: 'info',
  vehicle_issued: 'info',
  in_progress: 'info',
  return_due: 'pending',
  return_inspection: 'info',
  closure_review: 'pending',
  closed: 'success',
  cancelled: 'cancelled',
};
