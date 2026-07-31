/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * E2E Test Seed
 *
 * Lightweight idempotent seed that ensures the minimal test data exists
 * for E2E tests: vehicles, vehicle categories, driver profiles, and
 * login accounts.  Safe to run before every Playwright run.
 *
 * Run: pnpm db:seed-e2e
 */
import { getDb } from '@/db';
import {
  tenants,
  vehicles,
  vehicleCategories,
  employees,
  driverProfiles,
  driverLicences,
  vehicleAllocations,
  trips,
  offices,
  departments,
} from '@/db/schema';
import { eq, and, inArray, like } from 'drizzle-orm';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function seedE2e() {
  const db = getDb();

  // Verify tenant exists (created by main seed)
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, TENANT_ID as any)).limit(1);
  if (!tenant) {
    console.log('❌ Tenant not found. Run pnpm db:seed first to create the tenant and base data.');
    process.exit(1);
  }
  console.log('✅ Tenant found, ensuring E2E test data...');

  // Ensure offices exist
  const [headOffice] = await db.select({ id: offices.id }).from(offices)
    .where(and(eq(offices.tenantId, TENANT_ID as any), eq(offices.code, 'HOR'))).limit(1);
  const officeId = headOffice?.id;

  // Ensure departments exist
  await db.select({ id: departments.id }).from(departments)
    .where(and(eq(departments.tenantId, TENANT_ID as any), eq(departments.code, 'TFM'))).limit(1);

  // Ensure vehicle categories
  const catDataList = [
    { code: 'SEDAN', name: 'Sedan', passengerCapacity: 5 },
    { code: 'BAKKIE_DC', name: 'Bakkie (Double Cab)', passengerCapacity: 5 },
    { code: 'BAKKIE_SC', name: 'Bakkie (Single Cab)', passengerCapacity: 3 },
  ];
  const catIds: Record<string, string> = {};
  for (const cd of catDataList) {
    let [cat] = await db.select({ id: vehicleCategories.id }).from(vehicleCategories)
      .where(and(eq(vehicleCategories.tenantId, TENANT_ID as any), eq(vehicleCategories.code, cd.code))).limit(1);
    if (!cat) {
      [cat] = await db.insert(vehicleCategories).values({ tenantId: TENANT_ID as any, ...cd }).returning({ id: vehicleCategories.id });
    }
    catIds[cd.code] = cat.id;
  }

  // Ensure at least 2 available vehicles
  const existingVehicles = await db.select({ id: vehicles.id, licenceNumber: vehicles.licenceNumber, status: vehicles.status })
    .from(vehicles).where(eq(vehicles.tenantId, TENANT_ID as any));
  const availableCount = existingVehicles.filter((v) => v.status === 'available').length;

  if (availableCount < 2) {
    const needed = 2 - availableCount;
    const e2eVehicles = [
      { licenceNumber: 'E2E-SEDAN-001', make: 'Toyota', model: 'Corolla', colour: 'White', fuelType: 'petrol', currentOdometer: 45000, status: 'available', categoryId: catIds['SEDAN'], officeId },
      { licenceNumber: 'E2E-BAKKIE-001', make: 'Toyota', model: 'Hilux', colour: 'White', fuelType: 'diesel', currentOdometer: 18000, status: 'available', categoryId: catIds['BAKKIE_DC'], officeId },
    ];
    for (let i = 0; i < Math.min(needed, e2eVehicles.length); i++) {
      const v = e2eVehicles[i];
      const [existing] = await db.select({ id: vehicles.id }).from(vehicles)
        .where(and(eq(vehicles.tenantId, TENANT_ID as any), eq(vehicles.licenceNumber, v.licenceNumber))).limit(1);
      if (!existing) {
        await db.insert(vehicles).values({ tenantId: TENANT_ID as any, ...v });
        console.log(`  Created vehicle ${v.licenceNumber}`);
      }
    }
  }
  console.log(`  Vehicles: ${existingVehicles.length + Math.max(0, 2 - availableCount)} total (${Math.max(2, availableCount)} available)`);

  // Ensure driver KERC008 has an active driver profile
  const driverEmployees = await db.select({ id: employees.id, employeeNumber: employees.employeeNumber })
    .from(employees)
    .where(and(eq(employees.tenantId, TENANT_ID as any), eq(employees.isDriver, true)));
  for (const de of driverEmployees) {
    const [existingProfile] = await db.select({ id: driverProfiles.id }).from(driverProfiles)
      .where(eq(driverProfiles.employeeId, de.id)).limit(1);
    const profileId = existingProfile?.id;
    if (!profileId) {
      const [profile] = await db.insert(driverProfiles).values({
        employeeId: de.id,
        driverStatus: 'authorised',
        availabilityStatus: 'available',
        notes: 'E2E seed driver',
      }).returning();
      await db.insert(driverLicences).values({
        driverProfileId: profile.id,
        licenceNumber: `LIC-${de.employeeNumber}`,
        licenceClass: 'B',
        issueDate: '2023-01-01',
        expiryDate: '2028-12-31',
        isVerified: true,
        verificationStatus: 'verified',
      });
      console.log(`  Created driver profile + licence for ${de.employeeNumber}`);
    }
  }

  // Reset any vehicles that were left in 'allocated' or 'issued' state from
  // previous test runs back to 'available' so E2E tests can reuse them.
  const staleStatuses = ['allocated', 'issued', 'in_use'];
  for (const status of staleStatuses) {
    await db.update(vehicles).set({ status: 'available' })
      .where(and(eq(vehicles.tenantId, TENANT_ID as any), eq(vehicles.status, status)));
  }
  console.log('  Reset stale vehicle statuses to available');

  // ── Clean up stale test data from previous E2E runs ──
  // Find vehicles whose licence numbers start with 'E2E-' (created by the
  // test itself) and remove their stale allocations + trips.
  const e2eVehicles = await db.select({ id: vehicles.id })
    .from(vehicles)
    .where(and(
      eq(vehicles.tenantId, TENANT_ID as any),
      like(vehicles.licenceNumber, 'E2E-%'),
    ));
  const e2eVehicleIds = e2eVehicles.map((v) => v.id);

  if (e2eVehicleIds.length > 0) {
    // Close stale allocations (any state except cancelled)
    const staleStates = ['provisional', 'confirmed', 'released'];
    for (const state of staleStates) {
      await db.update(vehicleAllocations)
        .set({ state: 'cancelled' })
        .where(and(
          eq(vehicleAllocations.state, state),
          inArray(vehicleAllocations.vehicleId, e2eVehicleIds),
        ));
    }
    console.log(`  Cleaned allocations for ${e2eVehicleIds.length} E2E vehicle(s)`);

    // Close stale trips
    const staleTripStatuses = ['pending', 'in_progress', 'return_due', 'return_inspection', 'closure_review'];
    for (const tripStatus of staleTripStatuses) {
      await db.update(trips)
        .set({ status: 'closed' })
        .where(and(
          eq(trips.status, tripStatus),
          inArray(trips.vehicleId, e2eVehicleIds),
        ));
    }
    console.log(`  Closed stale trips for ${e2eVehicleIds.length} E2E vehicle(s)`);
  }

  console.log('✅ E2E seed complete!');
}

seedE2e()
  .catch((e: unknown) => {
    console.error('❌ E2E seed failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
