import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleCategories } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { eq, and, asc } from 'drizzle-orm';

/**
 * GET /api/reference
 *
 * Returns reference data for dropdown selectors — vehicle categories
 * and offices. Both are scoped to the authenticated tenant.
 */
export async function GET(_request: NextRequest) {
  const auth = await requireRequestAuth(_request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  try {
    const db = getDb();

    const [categories, allOffices] = await Promise.all([
      db
        .select({ id: vehicleCategories.id, name: vehicleCategories.name })
        .from(vehicleCategories)
        .where(
          and(
            eq(vehicleCategories.tenantId, session.tenantId),
            eq(vehicleCategories.isActive, true),
          ),
        )
        .orderBy(asc(vehicleCategories.name)),
      db
        .select({ id: offices.id, name: offices.name })
        .from(offices)
        .where(
          and(
            eq(offices.tenantId, session.tenantId),
            eq(offices.isActive, true),
          ),
        )
        .orderBy(asc(offices.name)),
    ]);

    return NextResponse.json({ categories, offices: allOffices });
  } catch (error) {
    console.error('Reference data query failed:', error);
    return NextResponse.json(
      { error: 'Failed to load reference data' },
      { status: 500 },
    );
  }
}
