/**
 * Vehicle Issue API
 *
 * POST /api/trips/[id]/issue — Record physical vehicle issue (keys, fuel card, odometer)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripIssues } from '@/db/schema/trips';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TRIP_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Fetch the trip with tenant isolation
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    if (trip.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot issue vehicle for trip with status "${trip.status}". Only pending trips can be issued.` },
        { status: 409 },
      );
    }

    if (!trip.allocationId) {
      return NextResponse.json(
        { error: 'Trip has no allocation. Cannot issue vehicle.' },
        { status: 400 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const {
      issueOdometer,
      keysIssued = true,
      fuelCardIssued = false,
      notes,
    } = body;

    // Check if an issue record already exists for this allocation
    const [existingIssue] = await db
      .select()
      .from(tripIssues)
      .where(eq(tripIssues.allocationId, trip.allocationId))
      .limit(1);

    if (existingIssue) {
      return NextResponse.json(
        { error: 'Vehicle already issued for this allocation' },
        { status: 409 },
      );
    }

    // Create the issue record
    const [issue] = await db
      .insert(tripIssues)
      .values({
        tripId: id,
        allocationId: trip.allocationId,
        issuedAt: new Date(),
        issueOdometer: issueOdometer || null,
        keysIssued,
        fuelCardIssued,
        issuedByUserId: session.user.id,
        notes: notes || null,
      })
      .returning();

    // Update trip issuedAt timestamp
    await db
      .update(trips)
      .set({ issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(trips.id, id));

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'vehicle_issued',
      actorUserId: session.user.id,
      action: 'issue',
      entityType: 'trip',
      entityId: id,
      summary: `Vehicle issued: keys=${keysIssued}, fuelCard=${fuelCardIssued}${issueOdometer ? `, odometer=${issueOdometer}` : ''}`,
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, issue });
  } catch (error) {
    console.error('[trips/issue] POST failed:', error);
    return NextResponse.json({ error: 'Failed to issue vehicle' }, { status: 500 });
  }
}
