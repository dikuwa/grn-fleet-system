/**
 * Driver Acknowledgement API
 *
 * POST /api/trips/[id]/acknowledge — Driver acknowledges trip authority before departure
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripIssues } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth } from '@/lib/auth-helpers';
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
        { error: `Cannot acknowledge trip with status "${trip.status}". Only pending trips can be acknowledged.` },
        { status: 409 },
      );
    }

    if (!trip.allocationId) {
      return NextResponse.json(
        { error: 'Trip has no allocation. Cannot acknowledge.' },
        { status: 400 },
      );
    }

    // Find the issue record for this trip's allocation
    const [issue] = await db
      .select()
      .from(tripIssues)
      .where(eq(tripIssues.allocationId, trip.allocationId))
      .limit(1);

    if (!issue) {
      return NextResponse.json(
        { error: 'Vehicle must be issued before driver can acknowledge. Please issue the vehicle first.' },
        { status: 400 },
      );
    }

    if (issue.acknowledgedAt) {
      return NextResponse.json(
        { error: 'Driver has already acknowledged this trip' },
        { status: 409 },
      );
    }

    // Find the current user's employee record to use as acknowledgedByDriverId
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    // Update the issue record with driver acknowledgement
    const [updatedIssue] = await db
      .update(tripIssues)
      .set({
        acknowledgedByDriverId: employee?.id || null,
        acknowledgedAt: new Date(),
      })
      .where(eq(tripIssues.id, issue.id))
      .returning();

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'driver_acknowledged',
      actorUserId: session.user.id,
      action: 'acknowledge',
      entityType: 'trip',
      entityId: id,
      summary: `Driver acknowledged trip authority`,
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, issue: updatedIssue });
  } catch (error) {
    console.error('[trips/acknowledge] POST failed:', error);
    return NextResponse.json({ error: 'Failed to acknowledge trip' }, { status: 500 });
  }
}
