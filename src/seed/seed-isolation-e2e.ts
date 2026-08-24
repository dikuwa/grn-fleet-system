/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cross-tenant E2E isolation fixture.
 *
 * The normal Playwright startup uses db:seed-e2e rather than the full
 * development seed. Cross-tenant tests must therefore not depend on a prior
 * manual `pnpm db:seed` run to create Tenant B.
 *
 * This seed is deliberately tiny and idempotent: an archived second tenant,
 * one office, one vehicle category, and one known vehicle. It creates no login
 * identity or membership for Tenant B.
 */
import { getDb } from '@/db';
import { tenants, offices, vehicleCategories, vehicles } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

const ISOLATION_TENANT_ID = '00000000-0000-0000-0000-000000000002';

async function seedIsolationE2e() {
  const db = getDb();

  await db
    .insert(tenants)
    .values({
      id: ISOLATION_TENANT_ID as any,
      name: 'Zambezi Regional Council — Isolation Fixture',
      code: 'ZRC',
      slug: 'zambezi-isolation',
      type: 'regional_council',
      status: 'ARCHIVED',
      planCode: 'INTERNAL_DEFAULT',
      subscriptionStatus: 'NOT_CONFIGURED',
      lifecycleStatus: 'ARCHIVED',
      timezone: 'Africa/Windhoek',
      locale: 'en-NA',
    })
    .onConflictDoNothing();

  let [office] = await db
    .select({ id: offices.id })
    .from(offices)
    .where(
      and(
        eq(offices.tenantId, ISOLATION_TENANT_ID as any),
        eq(offices.code, 'ZHO'),
      ),
    )
    .limit(1);

  if (!office) {
    [office] = await db
      .insert(offices)
      .values({
        tenantId: ISOLATION_TENANT_ID as any,
        name: 'Zambezi Head Office',
        type: 'head_office',
        code: 'ZHO',
      })
      .returning({ id: offices.id });
  }

  let [category] = await db
    .select({ id: vehicleCategories.id })
    .from(vehicleCategories)
    .where(
      and(
        eq(vehicleCategories.tenantId, ISOLATION_TENANT_ID as any),
        eq(vehicleCategories.code, 'ISO-SEDAN'),
      ),
    )
    .limit(1);

  if (!category) {
    [category] = await db
      .insert(vehicleCategories)
      .values({
        tenantId: ISOLATION_TENANT_ID as any,
        name: 'Isolation Sedan',
        code: 'ISO-SEDAN',
        passengerCapacity: 5,
      })
      .returning({ id: vehicleCategories.id });
  }

  const [vehicle] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.tenantId, ISOLATION_TENANT_ID as any),
        eq(vehicles.licenceNumber, 'ZRC-ISOLATION-001'),
      ),
    )
    .limit(1);

  if (!vehicle) {
    await db.insert(vehicles).values({
      tenantId: ISOLATION_TENANT_ID as any,
      categoryId: category.id,
      officeId: office.id,
      licenceNumber: 'ZRC-ISOLATION-001',
      vehicleRegisterNumber: 'N 99999 ZM',
      make: 'Isolation',
      model: 'Fixture',
      manufactureYear: 2025,
      fuelType: 'petrol',
      currentOdometer: 10,
      status: 'available',
    });
  }

  console.log('✅ Cross-tenant E2E isolation fixture ready');
}

seedIsolationE2e()
  .catch((error: unknown) => {
    console.error('❌ Cross-tenant E2E isolation seed failed:', error);
    process.exit(1);
  })
  .then(() => process.exit(0));
