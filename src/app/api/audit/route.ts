import { NextRequest, NextResponse } from 'next/server';
import { and, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { user } from '@/db/schema/better-auth';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { formatAuditEvent } from '@/lib/human-readable';

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.AUDIT_READ);
    if (permCheck instanceof NextResponse) return permCheck;

    const tenantId = session.tenantId;
    const eventType = searchParams.get('eventType');
    const search = searchParams.get('search');
    const action = searchParams.get('action');
    const entityType = searchParams.get('documentType');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const exportFormat = searchParams.get('export');

    if (exportFormat) {
      const exportCheck = await requirePermission(session, Permissions.AUDIT_EXPORT);
      if (exportCheck instanceof NextResponse) return exportCheck;
    }

    const requestedLimit = parseInt(searchParams.get('limit') || '50', 10);
    const requestedOffset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = exportFormat === 'csv' ? 5000 : Math.min(Math.max(requestedLimit, 1), 250);
    const offset = exportFormat === 'csv' ? 0 : Math.max(requestedOffset, 0);

    const db = getDb();
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
    const [totalResult] = await db.select({ count: count() }).from(auditEvents).where(whereClause);

    const eventRows = await db
      .select({ event: auditEvents, actorName: user.name })
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

    if (exportFormat === 'csv') {
      const header = [
        'Timestamp',
        'Event Type',
        'Action',
        'Summary',
        'Actor',
        'Actor User ID',
        'Entity Type',
        'Entity ID',
        'Source Channel',
        'Correlation ID',
      ];
      const rows = events.map((event) => [
        event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
        event.eventType,
        event.action,
        event.summary,
        event.actorName,
        event.actorUserId,
        event.entityType,
        event.entityId,
        event.sourceChannel,
        event.correlationId,
      ]);
      const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
      const stamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tenant-audit-${stamp}.csv"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

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
