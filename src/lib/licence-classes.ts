/**
 * Shared Namibian driver-licence class hierarchy.
 *
 * Used by release readiness, driver assignment validation and licence review so
 * that every check reasons about licence-class coverage the same way.
 *
 * Key: the driver's licence class. Value: the classes it covers (itself included).
 */
export const LICENCE_CLASS_HIERARCHY: Record<string, string[]> = {
  A: ['A', 'A1'],
  A1: ['A1'],
  B: ['B', 'EB', 'C', 'EC', 'CE'],
  EB: ['EB', 'B', 'C', 'EC', 'CE'],
  C: ['C', 'EC', 'CE', 'B', 'EB'],
  EC: ['EC', 'C', 'CE', 'EB', 'B'],
  CE: ['CE', 'C', 'EC', 'EB', 'B'],
};

/** True when the driver's licence class covers the vehicle's required class. */
export function licenceCoversClass(
  driverClass: string | null | undefined,
  requiredClass: string | null | undefined,
): boolean {
  if (!requiredClass) return true;
  if (!driverClass) return false;
  const upperDriver = driverClass.toUpperCase();
  const upperRequired = requiredClass.toUpperCase();
  return (
    upperDriver === upperRequired ||
    (LICENCE_CLASS_HIERARCHY[upperDriver]?.includes(upperRequired) ?? false)
  );
}

/** Verification states that mean "submitted but not yet finalised by Transport Administration". */
export const LICENCE_PENDING_STATUSES = [
  'uploaded',
  'pending',
  'awaiting_review',
  'needs_correction',
] as const;

export type LicencePendingStatus = (typeof LICENCE_PENDING_STATUSES)[number];
