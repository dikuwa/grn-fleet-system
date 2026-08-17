import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleCategories } from '@/db/schema/fleet';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

function categoryCode(name: string) {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 32);
  return normalized || 'CUSTOM';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requireAnyPermission(auth.session, [
      Permissions.VEHICLE_MANAGE,
      Permissions.VEHICLE_CREATE,
      Permissions.VEHICLE_UPDATE,
    ]);
    if (permission instanceof NextResponse) return permission;

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json(
        { error: 'Category name must be between 2 and 80 characters.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [existing] = await db
      .select({ id: vehicleCategories.id, name: vehicleCategories.name })
      .from(vehicleCategories)
      .where(
        and(
          eq(vehicleCategories.tenantId, auth.session.tenantId),
          sql`lower(${vehicleCategories.name}) = lower(${name})`,
        ),
      )
      .limit(1);
    if (existing) return NextResponse.json({ category: existing });

    const [category] = await db
      .insert(vehicleCategories)
      .values({
        tenantId: auth.session.tenantId,
        name,
        code: categoryCode(name),
        description: 'Custom tenant fleet category',
        passengerCapacity: 5,
        sortOrder: 1000,
      })
      .returning({ id: vehicleCategories.id, name: vehicleCategories.name });

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    console.error('[vehicle-categories] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create fleet category.' }, { status: 500 });
  }
}
