/**
 * Programme Activities API
 *
 * GET  /api/programmes  — List all programme activities across requests (tenant-scoped)
 * POST /api/programmes  — Create a new programme activity (creates a draft transport request)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests, requestActivities } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, desc, like, or, sql, type SQL } from 'drizzle-orm';

/**
 * GET /api/programmes
 * List all programme activities with transport request details.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const status = searchParams.get('status') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

    // Build conditions
    const conditions: SQL<unknown>[] = [eq(transportRequests.tenantId, session.tenantId)];
    if (status) {
      conditions.push(eq(transportRequests.status, status));
    }
    if (q) {
      conditions.push(
        or(
          like(requestActivities.title, `%${q}%`),
          like(transportRequests.reference, `%${q}%`),
        )!,
      );
    }

    // Count total
    const [countResult] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(requestActivities)
      .innerJoin(transportRequests, eq(requestActivities.requestId, transportRequests.id))
      .where(and(...conditions)!);

    const total = Number(countResult?.count || 0);
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    // Fetch activities with request info
    const rows = await db
      .select({
        id: requestActivities.id,
        title: requestActivities.title,
        description: requestActivities.description,
        venue: requestActivities.venue,
        startDate: requestActivities.startDate,
        endDate: requestActivities.endDate,
        estimatedKilometres: requestActivities.estimatedKilometres,
        requestId: requestActivities.requestId,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        requestScope: transportRequests.scope,
      })
      .from(requestActivities)
      .innerJoin(transportRequests, eq(requestActivities.requestId, transportRequests.id))
      .where(and(...conditions)!)
      .orderBy(desc(requestActivities.startDate))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      success: true,
      data: rows,
      total,
      page,
      totalPages,
      limit,
    });
  } catch (error) {
    console.error('[Programmes] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to list programmes: ' + String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/programmes
 * Create a new programme activity by creating a draft transport request with the activity.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.REQUEST_CREATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const { title, description, venue, startDate, endDate, estimatedKilometres } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (!startDate) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }

    const db = getDb();

    // Resolve the user's employee record for requester
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.userId, session.user.id),
          eq(employees.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!employee) {
      return NextResponse.json(
        { error: 'No employee record found for your user account' },
        { status: 400 },
      );
    }

    // Generate a reference number
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const [refCount] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(transportRequests)
      .where(eq(transportRequests.tenantId, session.tenantId));
    const seq = String((refCount?.count || 0) + 1).padStart(4, '0');

    // Create a draft transport request with the activity
    const now = new Date();
    const ref = `POA-${dateStr}-${seq}`;

    const [request] = await db
      .insert(transportRequests)
      .values({
        tenantId: session.tenantId,
        reference: ref,
        scope: 'regional',
        status: 'draft',
        requesterEmployeeId: employee.id,
        requesterUserId: session.user.id,
        purpose: description?.slice(0, 500) || `Programme: ${title}`,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create the activity record linked to the request
    const [activity] = await db
      .insert(requestActivities)
      .values({
        requestId: request.id,
        title: title.trim(),
        description: description?.trim() || null,
        venue: venue?.trim() || null,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : new Date(startDate),
        estimatedKilometres: estimatedKilometres ? Number(estimatedKilometres) : null,
      })
      .returning();

    return NextResponse.json({
      success: true,
      data: {
        ...activity,
        requestReference: ref,
        requestId: request.id,
        requestStatus: 'draft',
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[Programmes] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create programme: ' + String(error) },
      { status: 500 },
    );
  }
}
