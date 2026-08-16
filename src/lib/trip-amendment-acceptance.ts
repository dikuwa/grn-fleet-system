import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAmendments, tripAuthorities, trips } from '@/db/schema/trips';

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
  /** Effective material-change time: approval time, falling back to creation for legacy rows. */
  createdAt: Date;
  originalValue: Record<string, unknown> | null;
  newValue: Record<string, unknown>;
}

/**
 * A driver's acceptance belongs to the authority state they reviewed. Any
 * approved, driver-material amendment that became effective after that
 * acceptance must be acknowledged again before departure. Approval time is the
 * material-change boundary; a request drafted before driver acceptance but
 * approved afterward must still trigger re-acceptance.
 *
 * Re-acceptance is strictly a pre-departure control. Once the vehicle has been
 * physically issued/departed, the original authority remains historical
 * evidence and later amendments stay in amendment/version history without
 * reopening the departure-acceptance workflow.
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
      approvedAt: tripAmendments.approvedAt,
      originalValue: tripAmendments.originalValue,
      newValue: tripAmendments.newValue,
    })
    .from(tripAmendments)
    .innerJoin(tripAuthorities, eq(tripAuthorities.id, tripAmendments.authorityId))
    .innerJoin(trips, eq(trips.id, tripAuthorities.tripId))
    .where(
      and(
        eq(tripAmendments.authorityId, input.authorityId),
        inArray(tripAmendments.amendmentType, [...DRIVER_REACCEPTANCE_AMENDMENT_TYPES]),
        eq(tripAmendments.status, 'approved'),
        eq(trips.status, 'pending'),
        isNull(trips.issuedAt),
      ),
    )
    .orderBy(desc(tripAmendments.version), desc(tripAmendments.approvedAt), desc(tripAmendments.createdAt), desc(tripAmendments.id))
    .limit(1);

  if (!amendment) return null;
  const effectiveAt = amendment.approvedAt ?? amendment.createdAt;
  if (effectiveAt <= input.acceptedAt) return null;

  return {
    amendmentId: amendment.id,
    authorityId: amendment.authorityId,
    authorityVersion: amendment.version,
    amendmentType: amendment.amendmentType as DriverReacceptanceAmendmentType,
    reason: amendment.reason,
    createdAt: effectiveAt,
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
