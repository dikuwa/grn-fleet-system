/**
 * Shared employee status model — the single source of truth for
 * staff employment status, user account status and availability.
 *
 * Three independent concepts (never conflated):
 *
 *  1. Staff employment status  — active / inactive / archived (+ suspended)
 *  2. User account status      — active / suspended / pending_activation / disabled / locked
 *  3. Availability             — available / annual_leave / sick_leave / official_travel /
 *                                training / off_duty / temporarily_unavailable
 *
 * Storage canonical values are LOWERCASE for backward compatibility with the
 * existing schema (the database has always stored 'active', 'archived', ...).
 * All legacy and case variants normalise to these canonical values.
 */

// ---------------------------------------------------------------------------
// Employment status (staff)
// ---------------------------------------------------------------------------

export const EMPLOYEE_STATUSES = ['active', 'inactive', 'archived', 'suspended'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Canonical employment statuses a staff member may be set to. */
export const EMPLOYEE_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
  { value: 'suspended', label: 'Suspended' },
];

/**
 * Legacy employment statuses still present in historical data. They are kept
 * for reading/filtering but are never written and never rendered directly —
 * each maps to a canonical value.
 */
const LEGACY_STATUS_MAP: Record<string, EmployeeStatus> = {
  on_leave: 'inactive',
  acting_elsewhere: 'inactive',
  temporarily_unavailable: 'inactive',
  transferred: 'inactive',
  contract_ended: 'inactive',
  retired: 'inactive',
  deceased: 'inactive',
  inactive: 'inactive',
  active: 'active',
  suspended: 'suspended',
  archived: 'archived',
};

/**
 * Normalise any raw employment status value (case variants such as ACTIVE,
 * Active, legacy values, whitespace) to a canonical value.
 *
 * Returns `null` when the value cannot be mapped — callers decide whether to
 * reject (import/lifecycle) or fall back to a default.
 */
export function normaliseEmployeeStatus(raw: string | null | undefined): EmployeeStatus | null {
  if (!raw) return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!key) return null;
  return LEGACY_STATUS_MAP[key] ?? null;
}

/**
 * Employee status display configuration shared by Staff Directory, Employee
 * Detail, Import Preview, organisation counts, reports, filters and search.
 * Normalise BEFORE looking up — never colour raw text directly.
 */
export const employeeStatusConfig: Record<
  EmployeeStatus,
  { label: string; variant: 'success' | 'warning' | 'error' | 'default' }
> = {
  active: { label: 'Active', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'warning' },
  archived: { label: 'Archived', variant: 'default' },
  suspended: { label: 'Suspended', variant: 'error' },
};

export function getEmployeeStatusDisplay(raw: string | null | undefined): {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'default';
  canonical: EmployeeStatus | null;
} {
  const canonical = normaliseEmployeeStatus(raw);
  if (!canonical) {
    return { label: raw?.trim() || 'Unknown', variant: 'default', canonical: null };
  }
  const config = employeeStatusConfig[canonical];
  return { label: config.label, variant: config.variant, canonical };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export const AVAILABILITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'available', label: 'Available' },
  { value: 'annual_leave', label: 'Annual leave' },
  { value: 'sick_leave', label: 'Sick leave' },
  { value: 'official_travel', label: 'Official travel' },
  { value: 'training', label: 'Training' },
  { value: 'off_duty', label: 'Off duty' },
  { value: 'temporarily_unavailable', label: 'Temporarily unavailable' },
];

const AVAILABILITY_SET = new Set(AVAILABILITY_OPTIONS.map((option) => option.value));

export function normaliseAvailability(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return AVAILABILITY_SET.has(key) ? key : null;
}

export function getAvailabilityLabel(raw: string | null | undefined): string {
  const canonical = normaliseAvailability(raw);
  if (!canonical) return raw?.trim() || 'Unknown';
  return AVAILABILITY_OPTIONS.find((option) => option.value === canonical)!.label;
}

// ---------------------------------------------------------------------------
// User account status (User Management only)
// ---------------------------------------------------------------------------

export const ACCOUNT_STATUS_OPTIONS = [
  'active',
  'suspended',
  'pending_activation',
  'disabled',
  'locked',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUS_OPTIONS)[number];

export const accountStatusConfig: Record<
  AccountStatus,
  { label: string; variant: 'success' | 'pending' | 'error' | 'cancelled' }
> = {
  active: { label: 'Active', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'error' },
  pending_activation: { label: 'Pending Activation', variant: 'pending' },
  disabled: { label: 'Disabled', variant: 'cancelled' },
  locked: { label: 'Locked', variant: 'error' },
};

export function getAccountStatusDisplay(raw: string | null | undefined): {
  label: string;
  variant: 'success' | 'pending' | 'error' | 'cancelled';
} {
  const key = (raw || '').trim().toLowerCase() as AccountStatus;
  return accountStatusConfig[key] ?? { label: raw || 'No account', variant: 'cancelled' };
}
