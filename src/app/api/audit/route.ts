import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Require auth — audit data is tenant-scoped
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const tenantId = session.tenantId;

    const eventType = searchParams.get('eventType');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const db = getDb();

    // Build filters
    const conditions = [eq(auditEvents.tenantId, tenantId)];

    if (eventType && eventType !== 'all') {
      conditions.push(eq(auditEvents.eventType, eventType));
    }

    if (search) {
      conditions.push(
        sql`(${auditEvents.action} ILIKE ${'%' + search + '%'} OR ${auditEvents.actorUserId} ILIKE ${'%' + search + '%'} OR ${auditEvents.summary} ILIKE ${'%' + search + '%'})`,
      );
    }

    const whereClause = and(...conditions);

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(auditEvents)
      .where(whereClause);

    // Get events
    const events = await db
      .select()
      .from(auditEvents)
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit)
      .offset(offset);

    // Hash chain verification status (last 5 events)
    const lastEvents = await db
      .select({ id: auditEvents.id, eventHash: auditEvents.eventHash, previousHash: auditEvents.previousHash })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        events,
        total: totalResult?.count || 0,
        limit,
        offset,
        chainHead: lastEvents[0] || null,
      },
    });
  } catch (error) {
    console.error('Audit API failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit events: ' + String(error) },
      { status: 500 },
    );
  }
}
