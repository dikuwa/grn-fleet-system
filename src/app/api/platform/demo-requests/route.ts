/**
 * Platform Demo Request Management API
 *
 * GET   /api/platform/demo-requests — List all demo requests
 * PATCH /api/platform/demo-requests/[id] — Update demo request status/qualification
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { demoRequests } from '@/db/schema/demo-requests';
import { eq, and, desc, count, or, like } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// GET — List demo requests with stats
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const q = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    // Build filters
    const conditions: ReturnType<typeof and>[] = [];
    if (status) {
      conditions.push(eq(demoRequests.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(demoRequests)
      .where(whereClause);

    const total = totalResult?.count || 0;

    // Fetch requests
    const requests = await db
      .select()
      .from(demoRequests)
      .where(whereClause)
      .orderBy(desc(demoRequests.createdAt))
      .limit(limit)
      .offset(offset);

    // Apply search filter client-side
    let filtered = requests;
    if (q) {
      const query = q.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name?.toLowerCase().includes(query) ||
          r.email?.toLowerCase().includes(query) ||
          r.company?.toLowerCase().includes(query),
      );
    }

    // Stats
    const allRequests = await db.select().from(demoRequests);
    const stats = {
      total: allRequests.length,
      new: allRequests.filter((r) => r.status === 'new').length,
      qualified: allRequests.filter((r) => r.status === 'qualified').length,
      scheduled: allRequests.filter((r) => r.status === 'scheduled').length,
      completed: allRequests.filter((r) => r.status === 'completed').length,
      converted: allRequests.filter((r) => r.status === 'converted').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        requests: filtered,
        stats,
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
      },
    });
  } catch (error) {
    console.error('[Platform Demo Requests] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update demo request (qualify, schedule, etc.)
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { id, status, scheduledDemoAt, scheduledDemoLink, notes, qualifiedByUserId } = body;

    if (!id) {
      return NextResponse.json({ error: 'Demo request ID is required' }, { status: 400 });
    }

    const db = getDb();

    const [existing] = await db
      .select()
      .from(demoRequests)
      .where(eq(demoRequests.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Demo request not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (scheduledDemoAt) updates.scheduledDemoAt = new Date(scheduledDemoAt);
    if (scheduledDemoLink) updates.scheduledDemoLink = scheduledDemoLink;
    if (notes !== undefined) updates.contactNotes = notes;
    if (qualifiedByUserId) updates.qualifiedByUserId = qualifiedByUserId;
    if (status === 'qualified') updates.qualifiedAt = new Date();
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(demoRequests)
      .set(updates)
      .where(eq(demoRequests.id, id))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Demo Requests] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
