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
  roles,
  rolePermissions,
  permissions,
  generatedDocuments,
} from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { Permissions, RoleDefinitions } from '@/lib/permissions';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function seedE2e() {
  const db = getDb();

  // Verify tenant exists (created by main seed)
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, TENANT_ID as any))
    .limit(1);
  if (!tenant) {
    console.log('❌ Tenant not found. Run pnpm db:seed first to create the tenant and base data.');
    process.exit(1);
  }
  console.log('✅ Tenant found, ensuring E2E test data...');

  // ── Ensure the permission catalog exists (FK target for role_permissions) ──
  // Mirrors the main seed so role_permissions inserts never violate the
  // permission_code FK when new codes are added to src/lib/permissions.ts.
  const allPermissionCodes = Object.values(Permissions);
  for (const code of allPermissionCodes) {
    await db
      .insert(permissions)
      .values({
        code,
        name: code.replace(/[:-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        description: `Permission to ${code.replace(/[:-]/g, ' ')}`,
        group: code.split(':')[0],
      })
      .onConflictDoNothing();
  }

  // ── Sync system role permissions from RoleDefinitions (idempotent) ──
  // Keeps the E2E database in lockstep with src/lib/permissions.ts so tests
  // exercise the same grants the main seed produces (e.g. FILE_UPLOAD for
  // release officers) without requiring a full db:seed before each run.
  const rolePermMap: Record<string, readonly string[]> = {
    [RoleDefinitions.PLATFORM_SUPER_ADMIN.name]: RoleDefinitions.PLATFORM_SUPER_ADMIN.permissions,
    [RoleDefinitions.PLATFORM_SUPPORT.name]: RoleDefinitions.PLATFORM_SUPPORT.permissions,
    [RoleDefinitions.PLATFORM_AUDITOR.name]: RoleDefinitions.PLATFORM_AUDITOR.permissions,
    [RoleDefinitions.TENANT_ADMIN.name]: RoleDefinitions.TENANT_ADMIN.permissions,
    [RoleDefinitions.TRANSPORT_ADMIN.name]: RoleDefinitions.TRANSPORT_ADMIN.permissions,
    [RoleDefinitions.REQUESTER.name]: RoleDefinitions.REQUESTER.permissions,
    [RoleDefinitions.SUPERVISOR.name]: RoleDefinitions.SUPERVISOR.permissions,
    [RoleDefinitions.CONTROL_ADMIN_OFFICER.name]: RoleDefinitions.CONTROL_ADMIN_OFFICER.permissions,
    [RoleDefinitions.DEPUTY_DIRECTOR.name]: RoleDefinitions.DEPUTY_DIRECTOR.permissions,
    [RoleDefinitions.DIRECTOR.name]: RoleDefinitions.DIRECTOR.permissions,
    [RoleDefinitions.CHIEF_REGIONAL_OFFICER.name]:
      RoleDefinitions.CHIEF_REGIONAL_OFFICER.permissions,
    [RoleDefinitions.DRIVER.name]: RoleDefinitions.DRIVER.permissions,
    [RoleDefinitions.INSPECTOR.name]: RoleDefinitions.INSPECTOR.permissions,
    [RoleDefinitions.MAINTENANCE_OFFICER.name]: RoleDefinitions.MAINTENANCE_OFFICER.permissions,
    [RoleDefinitions.TENANT_AUDITOR.name]: RoleDefinitions.TENANT_AUDITOR.permissions,
  };
  const roleRecords = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(eq(roles.tenantId, TENANT_ID as any));
  for (const role of roleRecords) {
    const perms = rolePermMap[role.name];
    if (perms) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      if (perms.length > 0) {
        await db.insert(rolePermissions).values(
          perms.map((permCode: string) => ({
            roleId: role.id,
            permissionCode: permCode,
          })),
        );
      }
    }
  }
  console.log('  Synced role permissions from RoleDefinitions');

  // Ensure offices exist
  const [headOffice] = await db
    .select({ id: offices.id })
    .from(offices)
    .where(and(eq(offices.tenantId, TENANT_ID as any), eq(offices.code, 'HOR')))
    .limit(1);
  const officeId = headOffice?.id;

  // Ensure departments exist
  await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, TENANT_ID as any), eq(departments.code, 'TFM')))
    .limit(1);

  // Ensure vehicle categories
  const catDataList = [
    { code: 'SEDAN', name: 'Sedan', passengerCapacity: 5 },
    { code: 'BAKKIE_DC', name: 'Bakkie (Double Cab)', passengerCapacity: 5 },
    { code: 'BAKKIE_SC', name: 'Bakkie (Single Cab)', passengerCapacity: 3 },
  ];
  const catIds: Record<string, string> = {};
  for (const cd of catDataList) {
    let [cat] = await db
      .select({ id: vehicleCategories.id })
      .from(vehicleCategories)
      .where(
        and(eq(vehicleCategories.tenantId, TENANT_ID as any), eq(vehicleCategories.code, cd.code)),
      )
      .limit(1);
    if (!cat) {
      [cat] = await db
        .insert(vehicleCategories)
        .values({ tenantId: TENANT_ID as any, ...cd })
        .returning({ id: vehicleCategories.id });
    }
    catIds[cd.code] = cat.id;
  }

  // Ensure at least 2 available vehicles
  const existingVehicles = await db
    .select({ id: vehicles.id, licenceNumber: vehicles.licenceNumber, status: vehicles.status })
    .from(vehicles)
    .where(eq(vehicles.tenantId, TENANT_ID as any));
  const availableCount = existingVehicles.filter((v) => v.status === 'available').length;

  if (availableCount < 2) {
    const needed = 2 - availableCount;
    const e2eVehicles = [
      {
        licenceNumber: 'E2E-SEDAN-001',
        make: 'Toyota',
        model: 'Corolla',
        colour: 'White',
        fuelType: 'petrol',
        currentOdometer: 45000,
        status: 'available',
        categoryId: catIds['SEDAN'],
        officeId,
      },
      {
        licenceNumber: 'E2E-BAKKIE-001',
        make: 'Toyota',
        model: 'Hilux',
        colour: 'White',
        fuelType: 'diesel',
        currentOdometer: 18000,
        status: 'available',
        categoryId: catIds['BAKKIE_DC'],
        officeId,
      },
    ];
    for (let i = 0; i < Math.min(needed, e2eVehicles.length); i++) {
      const v = e2eVehicles[i];
      const [existing] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(eq(vehicles.tenantId, TENANT_ID as any), eq(vehicles.licenceNumber, v.licenceNumber)),
        )
        .limit(1);
      if (!existing) {
        await db.insert(vehicles).values({ tenantId: TENANT_ID as any, ...v });
        console.log(`  Created vehicle ${v.licenceNumber}`);
      }
    }
  }
  console.log(
    `  Vehicles: ${existingVehicles.length + Math.max(0, 2 - availableCount)} total (${Math.max(2, availableCount)} available)`,
  );

  // Ensure driver KERC008 has an active driver profile
  const driverEmployees = await db
    .select({ id: employees.id, employeeNumber: employees.employeeNumber })
    .from(employees)
    .where(and(eq(employees.tenantId, TENANT_ID as any), eq(employees.isDriver, true)));
  for (const de of driverEmployees) {
    const [existingProfile] = await db
      .select({ id: driverProfiles.id })
      .from(driverProfiles)
      .where(eq(driverProfiles.employeeId, de.id))
      .limit(1);
    const profileId = existingProfile?.id;
    if (!profileId) {
      const [profile] = await db
        .insert(driverProfiles)
        .values({
          employeeId: de.id,
          driverStatus: 'authorised',
          availabilityStatus: 'available',
          notes: 'E2E seed driver',
        })
        .returning();
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
    await db
      .update(vehicles)
      .set({ status: 'available' })
      .where(and(eq(vehicles.tenantId, TENANT_ID as any), eq(vehicles.status, status)));
  }
  console.log('  Reset stale vehicle statuses to available');

  // ── Ensure document-system E2E fixtures (idempotent) ──
  // document-system-redesign.spec.ts renders, downloads, prints and shares real
  // generated documents. The heavy seed-documents.ts script is manual-only, so
  // seed the two documents that spec exercises directly. Fixed IDs make this
  // safe to run before every Playwright run.
  const [transportAdminEmployee] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.tenantId, TENANT_ID as any), eq(employees.employeeNumber, 'KERC011')))
    .limit(1);
  const generatedByUserId =
    transportAdminEmployee?.userId || '00000000-0000-0000-0000-000000000001';
  const docFixtures = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      documentType: 'transport_request',
      entityType: 'transport_request',
      snapshotData: {
        reference: 'GRN/TR/E2E/REQ-1001',
        scope: 'regional',
        status: 'issued',
        department: 'Transport and Fleet Management',
        purpose: 'E2E document viewer fixture — official transport request',
        submittedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        totalAuthorisedKilometres: 240,
        specialAuthorityRequired: false,
        requester: {
          name: 'Ndapewa Hamutenya',
          employeeNumber: 'KERC011',
          department: 'Transport and Fleet Management',
          office: 'Head Office — Rundu',
          designation: 'Transport Administrator',
        },
        travellers: ['Requester', 'Regional Officer'],
        passengers: [
          {
            name: 'Ndapewa Hamutenya',
            employeeNumber: 'KERC011',
            departmentOrOrganisation: 'Transport and Fleet Management',
            travellerType: 'requester',
          },
        ],
        routes: [
          { originName: 'Rundu', destinationName: 'Divundu', estimatedKilometres: 120 },
          { originName: 'Divundu', destinationName: 'Rundu', estimatedKilometres: 120 },
        ],
        drivers: [
          {
            name: 'Michael Mwala',
            employeeNumber: 'KERC008',
            licenceNumberMasked: '****5678',
            licenceClass: 'B',
            driverType: 'primary',
          },
        ],
        documentIdentity: {
          organisationName: 'Kavango East Regional Council',
          code: 'KERC',
        },
      },
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      documentType: 'trip_authority',
      entityType: 'trip',
      snapshotData: {
        reference: 'TA-2026-KERC-000142',
        authorityNumber: 'TA-2026-KERC-000142',
        status: 'issued',
        purpose: 'E2E document viewer fixture — official trip authority',
        tenantName: 'Kavango East Regional Council',
        vehicle: {
          registration: 'GRN-003-2024',
          make: 'Toyota',
          model: 'Hilux',
          colour: 'White',
          fuelType: 'diesel',
        },
        drivers: [
          {
            name: 'Michael Mwala',
            employeeNumber: 'KERC008',
            licenceNumberMasked: '****5678',
          },
        ],
        documentIdentity: {
          organisationName: 'Kavango East Regional Council',
          code: 'KERC',
        },
      },
    },
  ];
  for (const fixture of docFixtures) {
    await db
      .insert(generatedDocuments)
      .values({
        id: fixture.id as any,
        tenantId: TENANT_ID as any,
        documentType: fixture.documentType,
        entityType: fixture.entityType,
        entityId: fixture.id as any,
        snapshotData: fixture.snapshotData,
        status: 'issued',
        redactionProfile: 'internal',
        hash: 'e2e-document-fixture-hash',
        generatedByUserId,
      })
      .onConflictDoUpdate({
        target: generatedDocuments.id,
        set: {
          snapshotData: fixture.snapshotData,
          status: 'issued',
          redactionProfile: 'internal',
          hash: 'e2e-document-fixture-hash',
          generatedByUserId,
        },
      });
  }
  console.log('  Ensured document-system E2E fixtures (transport_request, trip_authority)');

  // ── Clean up stale test data from previous E2E runs ──
  // Previous runs can leave allocations in provisional/confirmed/issued and
  // trips in open states.  Those stale records make the driver-overlap check
  // (allocations state in provisional/confirmed/issued) reject legitimate new
  // assignments with a 409 on the next run.  Cancel every stale allocation and
  // close every stale trip for the whole tenant so the suite starts clean.
  // vehicle_allocations has no tenantId column — scope via the tenant's vehicles.
  const staleAllocStates = ['provisional', 'confirmed', 'issued'];
  const tenantVehicleIds = db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.tenantId, TENANT_ID as any));
  await db
    .update(vehicleAllocations)
    .set({ state: 'cancelled' })
    .where(
      and(
        inArray(vehicleAllocations.vehicleId, tenantVehicleIds),
        inArray(vehicleAllocations.state, staleAllocStates),
      ),
    );
  const staleTripStatuses = [
    'pending',
    'in_progress',
    'return_due',
    'return_inspection',
    'closure_review',
  ];
  for (const tripStatus of staleTripStatuses) {
    await db
      .update(trips)
      .set({ status: 'closed' })
      .where(and(eq(trips.tenantId, TENANT_ID as any), eq(trips.status, tripStatus)));
  }
  console.log('  Cleaned stale tenant-wide allocations and trips');

  console.log('✅ E2E seed complete!');
}

seedE2e()
  .catch((e: unknown) => {
    console.error('❌ E2E seed failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
