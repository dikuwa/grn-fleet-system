import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, ilike, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { fuelTransactions, trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { requestRoutes } from '@/db/schema/requests';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';

/**
 * GET /api/fuel/stations
 *
 * Returns tenant-scoped station names already confirmed in fuel records and,
 * when a trip is supplied, lightweight route-place hints. The endpoint never
 * invents station names: drivers can always keep typing a manual value.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const createCheck = await requireDashboardAction(session, '/dashboard/fuel/new', 'create');
    if (createCheck instanceof NextResponse) return createCheck;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const tripId = searchParams.get('tripId')?.trim() || '';
    const db = getDb();

    const stationConditions = [
      eq(vehicles.tenantId, session.tenantId),
      isNotNull(fuelTransactions.stationName),
      sql`length(trim(${fuelTransactions.stationName})) > 0`,
    ];
    if (search) stationConditions.push(ilike(fuelTransactions.stationName, `%${search}%`));

    const stationRows = await db
      .select({
        name: fuelTransactions.stationName,
        uses: sql<number>`count(*)`,
        lastUsedAt: sql<Date>`max(${fuelTransactions.transactionAt})`,
      })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(...stationConditions))
      .groupBy(fuelTransactions.stationName)
      .orderBy(desc(sql`max(${fuelTransactions.transactionAt})`), desc(sql`count(*)`))
      .limit(10);

    let routeHints: string[] = [];
    if (tripId) {
      const routeRows = await db
        .select({
          originName: requestRoutes.originName,
          destinationName: requestRoutes.destinationName,
        })
        .from(trips)
        .innerJoin(requestRoutes, eq(requestRoutes.requestId, trips.requestId))
        .where(and(eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)))
        .limit(10);

      routeHints = Array.from(
        new Set(
          routeRows
            .flatMap((row) => [row.originName, row.destinationName])
            .map((value) => value?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      );
    }

    return NextResponse.json({
      success: true,
      suggestions: stationRows
        .filter((row): row is typeof row & { name: string } => Boolean(row.name))
        .map((row) => ({
          name: row.name,
          uses: Number(row.uses || 0),
          source: 'tenant_history' as const,
        })),
      routeHints,
    });
  } catch (error) {
    console.error('[fuel/stations] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load station suggestions' }, { status: 500 });
  }
}
