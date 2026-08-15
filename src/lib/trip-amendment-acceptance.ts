import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAmendments } from '@/db/schema/trips';

export interface PendingVehicleReplacementAcceptance {
  amendmentId: string;
  authorityId: string;
  authorityVersion: number;
  reason: string;
  createdAt: Date;
  originalValue: Record<string, unknown> | null;
  newValue: Record<string, unknown>;
}

/**
 * A driver's acceptance belongs to the authority state they reviewed. If a
 * material vehicle replacement is recorded after that acceptance, the revised
 * authority must be acknowledged again. The original workflow acknowledgement
 * remains immutable. If the authority has never been accepted, there is no
 * re-acceptance to perform: the normal first acknowledgement workflow will
 * cover the current vehicle and authority version.
 */
export async function findPendingVehicleReplacementAcceptance(input: {
  authorityId: string;
  acceptedAt: Date | null;
}): Promise<PendingVehicleReplacementAcceptance | null> {
  if (!input.acceptedAt) return null;

  const db = getDb();
  const [amendment] = await db
    .select({
      id: tripAmendments.id,
      authorityId: tripAmendments.authorityId,
      version: tripAmendments.version,
      reason: tripAmendments.reason,
      createdAt: tripAmendments.createdAt,
      originalValue: tripAmendments.originalValue,
      newValue: tripAmendments.newValue,
    })
    .from(tripAmendments)
    .where(
      and(
        eq(tripAmendments.authorityId, input.authorityId),
        eq(tripAmendments.amendmentType, 'vehicle_replacement'),
        eq(tripAmendments.status, 'approved'),
      ),
    )
    .orderBy(desc(tripAmendments.version), desc(tripAmendments.createdAt))
    .limit(1);

  if (!amendment || amendment.createdAt <= input.acceptedAt) return null;

  return {
    amendmentId: amendment.id,
    authorityId: amendment.authorityId,
    authorityVersion: amendment.version,
    reason: amendment.reason,
    createdAt: amendment.createdAt,
    originalValue: amendment.originalValue ?? null,
    newValue: amendment.newValue,
  };
}
