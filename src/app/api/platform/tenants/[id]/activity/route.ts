import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { requireRequestAuth, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

/**
 * GET /api/platform/tenants/[id]/activity
 * Fetch audit events for a specific tenant (requires PLATFORM_ADMIN or TENANT_MANAGE)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: tenantId } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requireAnyPermission(session, [Permissions.PLATFORM_ADMIN, Permissions.TENANT_MANAGE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const eventType = searchParams.get('eventType');

    const db = getDb();

    const conditions = [eq(auditEvents.tenantId, tenantId)];

    if (eventType && eventType !== 'all') {
      conditions.push(eq(auditEvents.eventType, eventType));
    }

    const whereClause = and(...conditions);

    const [totalResult] = await db
      .select({ count: count() })
      .from(auditEvents)
      .where(whereClause);

    const events = await db
      .select()
      .from(auditEvents)
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit)
      .offset(offset);

    // Get distinct event types for filtering
    const eventTypes = await db
      .select({ type: auditEvents.eventType })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId))
      .groupBy(auditEvents.eventType)
      .orderBy(auditEvents.eventType);

    return NextResponse.json({
      success: true,
      data: {
        events,
        total: totalResult?.count || 0,
        limit,
        offset,
        eventTypes: eventTypes.map((r) => r.type),
      },
    });
  } catch (error) {
    console.error('[Tenant Activity] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load activity: ' + String(error) },
      { status: 500 },
    );
  }
}
