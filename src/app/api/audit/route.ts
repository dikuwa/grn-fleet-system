import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { user } from '@/db/schema/better-auth';
import { eq, and, desc, count, sql, gte, lte, ilike } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { formatAuditEvent } from '@/lib/human-readable';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Require auth — audit data is tenant-scoped
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require AUDIT_READ permission
    const permCheck = await requirePermission(session, Permissions.AUDIT_READ);
    if (permCheck instanceof NextResponse) return permCheck;

    const tenantId = session.tenantId;

    const eventType = searchParams.get('eventType');
    const search = searchParams.get('search');
    const action = searchParams.get('action');
    const entityType = searchParams.get('documentType');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const db = getDb();

    // Build filters
    const conditions = [eq(auditEvents.tenantId, tenantId)];

    if (eventType && eventType !== 'all') {
      conditions.push(ilike(auditEvents.eventType, `${eventType}%`));
    }
    if (action) conditions.push(ilike(auditEvents.action, `%${action}%`));
    if (entityType) conditions.push(eq(auditEvents.entityType, entityType));
    if (dateFrom) conditions.push(gte(auditEvents.createdAt, new Date(`${dateFrom}T00:00:00`)));
    if (dateTo) conditions.push(lte(auditEvents.createdAt, new Date(`${dateTo}T23:59:59.999`)));

    if (search) {
      conditions.push(
        sql`(${auditEvents.action} ILIKE ${'%' + search + '%'} OR ${auditEvents.actorUserId} ILIKE ${'%' + search + '%'} OR ${auditEvents.summary} ILIKE ${'%' + search + '%'})`,
      );
    }

    const whereClause = and(...conditions);

    // Get total count
    const [totalResult] = await db.select({ count: count() }).from(auditEvents).where(whereClause);

    // Get events
    const eventRows = await db
      .select({
        event: auditEvents,
        actorName: user.name,
      })
      .from(auditEvents)
      .leftJoin(user, eq(user.id, auditEvents.actorUserId))
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit)
      .offset(offset);
    const events = eventRows.map(({ event, actorName }) => {
      const formatted = formatAuditEvent({
        eventType: event.eventType,
        action: event.action,
        entityType: event.entityType,
        summary: event.summary,
        actorName,
      });
      return {
        ...event,
        actorName: actorName || 'GovFleet',
        displayTitle: formatted.title,
        displayDescription: formatted.description,
      };
    });

    // Hash chain verification status (last 5 events)
    const lastEvents = await db
      .select({
        id: auditEvents.id,
        eventHash: auditEvents.eventHash,
        previousHash: auditEvents.previousHash,
      })
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
