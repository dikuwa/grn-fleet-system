/**
 * Client-safe MVA constants and types.
 *
 * This module contains ONLY types, enums, and constants that are safe
 * to import in client components ('use client'). It does NOT import
 * '@/db' or any server-only code.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvestigationStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_information'
  | 'no_action'
  | 'closed';
export type TechnicalClearanceStatus = 'pending' | 'cleared' | 'not_cleared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INVESTIGATION_STATUSES: InvestigationStatus[] = [
  'pending',
  'in_progress',
  'awaiting_information',
  'no_action',
  'closed',
];

export const TECHNICAL_CLEARANCE_STATUSES: TechnicalClearanceStatus[] = [
  'pending',
  'cleared',
  'not_cleared',
];

export const INVESTIGATION_STATUS_LABELS: Record<InvestigationStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  awaiting_information: 'Awaiting information',
  no_action: 'No action required',
  closed: 'Closed',
};

export const TECHNICAL_CLEARANCE_STATUS_LABELS: Record<TechnicalClearanceStatus, string> = {
  pending: 'Pending',
  cleared: 'Cleared',
  not_cleared: 'Not Cleared',
};