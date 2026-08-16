import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAmendments } from '@/db/schema/trips';

export const DRIVER_REACCEPTANCE_AMENDMENT_TYPES = [
  'vehicle_replacement',
  'date_extension',
  'route_change',
  'purpose_clarification',
  'special_authorisation',
] as const;

export type DriverReacceptanceAmendmentType =
  (typeof DRIVER_REACCEPTANCE_AMENDMENT_TYPES)[number];

export interface PendingAuthorityAmendmentAcceptance {
  amendmentId: string;
  authorityId: string;
  authorityVersion: number;
  amendmentType: DriverReacceptanceAmendmentType;
  reason: string;
  createdAt: Date;
  originalValue: Record<string, unknown> | null;
  newValue: Record<string, unknown>;
}

/**
 * A driver's acceptance belongs to the authority state they reviewed. Any
 * approved, driver-material amendment recorded after that acceptance must be
 * acknowledged again before departure. This includes vehicle replacement as
 * well as route, validity, purpose and special-authorisation changes.
 *
 * The original workflow acknowledgement remains immutable audit history. If
 * the authority has never been accepted, there is no re-acceptance to perform:
 * the normal first acknowledgement workflow covers the latest authority state.
 */
export async function findPendingAuthorityAmendmentAcceptance(input: {
  authorityId: string;
  acceptedAt: Date | null;
}): Promise<PendingAuthorityAmendmentAcceptance | null> {
  if (!input.acceptedAt) return null;

  const db = getDb();
  const [amendment] = await db
    .select({
      id: tripAmendments.id,
      authorityId: tripAmendments.authorityId,
      version: tripAmendments.version,
      amendmentType: tripAmendments.amendmentType,
      reason: tripAmendments.reason,
      createdAt: tripAmendments.createdAt,
      originalValue: tripAmendments.originalValue,
      newValue: tripAmendments.newValue,
    })
    .from(tripAmendments)
    .where(
      and(
        eq(tripAmendments.authorityId, input.authorityId),
        inArray(tripAmendments.amendmentType, [...DRIVER_REACCEPTANCE_AMENDMENT_TYPES]),
        eq(tripAmendments.status, 'approved'),
      ),
    )
    .orderBy(desc(tripAmendments.version), desc(tripAmendments.createdAt), desc(tripAmendments.id))
    .limit(1);

  if (!amendment || amendment.createdAt <= input.acceptedAt) return null;

  return {
    amendmentId: amendment.id,
    authorityId: amendment.authorityId,
    authorityVersion: amendment.version,
    amendmentType: amendment.amendmentType as DriverReacceptanceAmendmentType,
    reason: amendment.reason,
    createdAt: amendment.createdAt,
    originalValue: amendment.originalValue ?? null,
    newValue: amendment.newValue,
  };
}

/**
 * Legacy compatibility export. Older callers were written when vehicle
 * replacement was the only material amendment. Keep them safe by applying the
 * full material-amendment rule until their names/UI copy are migrated.
 */
export async function findPendingVehicleReplacementAcceptance(input: {
  authorityId: string;
  acceptedAt: Date | null;
}): Promise<PendingAuthorityAmendmentAcceptance | null> {
  return findPendingAuthorityAmendmentAcceptance(input);
}
