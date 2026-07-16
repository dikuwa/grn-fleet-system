/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Development Seed Data
 *
 * Creates Kavango East tenant with offices, departments, employees,
 * vehicle categories, vehicles, roles, permissions, and workflow definitions.
 *
 * All emails are fictional (.test TLD). No login accounts are created.
 *
 * NOTE: This seed is designed for fresh databases.
 * On re-run, it will fail on unique constraint violations.
 * For development, run: pnpm db:seed
 */
import { getDb } from '@/db';
import {
  tenants,
  tenantBranding,
  tenantMemberships,
  roles,
  permissions,
  rolePermissions,
  offices,
  departments,
  employees,
  vehicleCategories,
  vehicles,
  workflowDefinitions,
  workflowSteps,
  user,
  account,
} from '@/db/schema';
import { Permissions, RoleDefinitions } from '@/lib/permissions';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

type StaffRow = {
  empNo: string;
  title: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  dept: string;
  office: string;
  isDriver: boolean;
};

async function seed() {
  const db = getDb();

  console.log('🌱 Seeding development data...');

  // 1. Create Kavango East tenant
  console.log('Creating tenant...');
  await db.insert(tenants).values({
    id: TENANT_ID as any,
    name: 'Kavango East Regional Council',
    code: 'KERC',
    slug: 'kavango-east',
    type: 'regional_council',
    status: 'active',
    timezone: 'Africa/Windhoek',
    locale: 'en-NA',
  });

  // 2. Create tenant branding
  await db.insert(tenantBranding).values({
    tenantId: TENANT_ID as any,
    contactEmail: 'transport@kavangoeast.gov.na',
    contactPhone: '+264 66 123 456',
    address: 'Government Building, Rundu, Namibia',
    documentFooter: 'Kavango East Regional Council — Fleet Management',
    senderName: 'Kavango East Transport',
    senderEmail: 'transport@kavangoeast.gov.na',
  });

  // 3. Create offices
  console.log('Creating offices...');
  const [headOffice] = await db
    .insert(offices)
    .values({
      tenantId: TENANT_ID as any,
      name: 'Head Office — Rundu',
      type: 'head_office',
      code: 'HOR',
      address: 'Rundu, Kavango East',
      email: 'info@kavangoeast.gov.na',
      phone: '+264 66 123 400',
    })
    .returning();

  const constituencyOffices = await db
    .insert(offices)
    .values([
      { tenantId: TENANT_ID as any, parentId: headOffice.id, name: 'Rundu Urban Constituency Office', type: 'constituency_office', code: 'RUO' },
      { tenantId: TENANT_ID as any, parentId: headOffice.id, name: 'Rundu Rural West Constituency Office', type: 'constituency_office', code: 'RRW' },
      { tenantId: TENANT_ID as any, parentId: headOffice.id, name: 'Rundu Rural East Constituency Office', type: 'constituency_office', code: 'RRE' },
      { tenantId: TENANT_ID as any, parentId: headOffice.id, name: 'Mukwe Constituency Office', type: 'constituency_office', code: 'MKO' },
      { tenantId: TENANT_ID as any, parentId: headOffice.id, name: 'Kapako Constituency Office', type: 'constituency_office', code: 'KPO' },
      { tenantId: TENANT_ID as any, parentId: headOffice.id, name: 'Mashare Constituency Office', type: 'constituency_office', code: 'MSO' },
      { tenantId: TENANT_ID as any, parentId: headOffice.id, name: 'Nkurenkuru Settlement Office', type: 'settlement_office', code: 'NKO' },
    ])
    .returning();

  // 4. Create departments
  console.log('Creating departments...');
  await db.insert(departments).values([
    { tenantId: TENANT_ID as any, name: 'Office of the Chief Regional Officer', code: 'CRO' },
    { tenantId: TENANT_ID as any, name: 'Transport and Fleet Management', code: 'TFM' },
    { tenantId: TENANT_ID as any, name: 'Administration and Finance', code: 'ADM' },
    { tenantId: TENANT_ID as any, name: 'Community Development', code: 'CD' },
    { tenantId: TENANT_ID as any, name: 'Infrastructure and Planning', code: 'INP' },
  ]);

  // 5. Create all permissions
  console.log('Creating permissions...');
  const allPermissionCodes = Object.values(Permissions);
  await db.insert(permissions).values(
    allPermissionCodes.map((code) => ({
      code,
      name: code.replace(/[:-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      description: `Permission to ${code.replace(/[:-]/g, ' ')}`,
      group: code.split(':')[0],
    })),
  );

  // 6. Create default roles
  console.log('Creating roles...');
  const roleRecords = await db
    .insert(roles)
    .values([
      { tenantId: TENANT_ID as any, name: RoleDefinitions.TRANSPORT_ADMIN.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.REQUESTER.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.SUPERVISOR.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.CONTROL_ADMIN_OFFICER.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.DEPUTY_DIRECTOR.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.DIRECTOR.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.CHIEF_REGIONAL_OFFICER.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.DRIVER.name, isSystem: true },
      { tenantId: TENANT_ID as any, name: RoleDefinitions.TENANT_AUDITOR.name, isSystem: true },
    ])
    .returning();

  // 7. Assign permissions to roles
  console.log('Assigning role permissions...');
  const rolePermMap: Record<string, readonly string[]> = {
    [RoleDefinitions.TRANSPORT_ADMIN.name]: RoleDefinitions.TRANSPORT_ADMIN.permissions,
    [RoleDefinitions.REQUESTER.name]: RoleDefinitions.REQUESTER.permissions,
    [RoleDefinitions.SUPERVISOR.name]: RoleDefinitions.SUPERVISOR.permissions,
    [RoleDefinitions.CONTROL_ADMIN_OFFICER.name]: RoleDefinitions.CONTROL_ADMIN_OFFICER.permissions,
    [RoleDefinitions.DEPUTY_DIRECTOR.name]: RoleDefinitions.DEPUTY_DIRECTOR.permissions,
    [RoleDefinitions.DIRECTOR.name]: RoleDefinitions.DIRECTOR.permissions,
    [RoleDefinitions.CHIEF_REGIONAL_OFFICER.name]: RoleDefinitions.CHIEF_REGIONAL_OFFICER.permissions,
    [RoleDefinitions.DRIVER.name]: RoleDefinitions.DRIVER.permissions,
    [RoleDefinitions.TENANT_AUDITOR.name]: RoleDefinitions.TENANT_AUDITOR.permissions,
  };

  for (const role of roleRecords) {
    const perms = rolePermMap[role.name];
    if (perms) {
      await db.insert(rolePermissions).values(
        perms.map((permCode: string) => ({
          roleId: role.id,
          permissionCode: permCode,
        })),
      );
    }
  }

  // 8. Create sample employees
  console.log('Creating employees...');
  const staffData: StaffRow[] = [
    { empNo: 'KERC001', title: 'Mr', firstName: 'Kandjimi', lastName: 'Amupanda', jobTitle: 'Transport Administrator', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC002', title: 'Ms', firstName: 'Maria', lastName: 'Shikongo', jobTitle: 'Programme Officer', dept: 'Community Development', office: 'Rundu Urban Constituency Office', isDriver: false },
    { empNo: 'KERC003', title: 'Mr', firstName: 'Petrus', lastName: 'Ndara', jobTitle: 'Supervisor', dept: 'Community Development', office: 'Rundu Urban Constituency Office', isDriver: false },
    { empNo: 'KERC004', title: 'Mr', firstName: 'Erastus', lastName: 'Hausiku', jobTitle: 'Control Administrative Officer', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC005', title: 'Ms', firstName: 'Loide', lastName: 'Kandjiri', jobTitle: 'Deputy Director', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC006', title: 'Mr', firstName: 'Tomas', lastName: 'Sikongo', jobTitle: 'Director', dept: 'Infrastructure and Planning', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC007', title: 'Mr', firstName: 'Rafael', lastName: 'Kasume', jobTitle: 'Chief Regional Officer', dept: 'Office of the Chief Regional Officer', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC008', title: 'Mr', firstName: 'Michael', lastName: 'Mwala', jobTitle: 'Driver', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: true },
    { empNo: 'KERC009', title: 'Ms', firstName: 'Selma', lastName: 'Nangula', jobTitle: 'Driver', dept: 'Transport and Fleet Management', office: 'Rundu Urban Constituency Office', isDriver: true },
    { empNo: 'KERC010', title: 'Mr', firstName: 'Johannes', lastName: 'Shivute', jobTitle: 'Tenant Auditor', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
  ];

  const officeMap: Record<string, string> = {};
  for (const office of [headOffice, ...constituencyOffices]) {
    officeMap[office.name] = office.id;
  }

  const allDepts = await db.select().from(departments);
  const deptMap: Record<string, string> = {};
  for (const d of allDepts) {
    deptMap[d.name] = d.id;
  }

  for (const s of staffData) {
    await db.insert(employees).values({
      tenantId: TENANT_ID as any,
      employeeNumber: s.empNo,
      title: s.title,
      firstName: s.firstName,
      lastName: s.lastName,
      jobTitle: s.jobTitle,
      departmentId: s.dept ? deptMap[s.dept] : undefined,
      officeId: s.office ? officeMap[s.office] : undefined,
      email: `${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@kavangoeast.test`,
      phone: '+264 81 000 0000',
      employmentStatus: 'active',
      isDriver: s.isDriver,
    });
  }

  // 9. Create vehicle categories
  console.log('Creating vehicle categories...');
  await db.insert(vehicleCategories).values([
    { tenantId: TENANT_ID as any, name: 'Sedan', code: 'SEDAN', description: 'Standard 4-door passenger vehicle suitable for tarred roads', passengerCapacity: 5, suitableTerrain: 'tar', fuelType: 'petrol' },
    { tenantId: TENANT_ID as any, name: 'Bakkie (Double Cab)', code: 'BAKKIE_DC', description: 'Pickup truck with double cab, suitable for gravel roads and field work', passengerCapacity: 5, suitableTerrain: 'gravel', fuelType: 'diesel' },
    { tenantId: TENANT_ID as any, name: 'Bakkie (Single Cab)', code: 'BAKKIE_SC', description: 'Pickup truck with single cab, for cargo and field work', passengerCapacity: 3, suitableTerrain: 'gravel', fuelType: 'diesel' },
  ]);

  // 10. Create sample vehicles
  console.log('Creating vehicles...');
  const [sedanCat] = await db.select().from(vehicleCategories).where(eq(vehicleCategories.code, 'SEDAN')).limit(1);
  const [bakkieDCCat] = await db.select().from(vehicleCategories).where(eq(vehicleCategories.code, 'BAKKIE_DC')).limit(1);

  await db.insert(vehicles).values([
    { tenantId: TENANT_ID as any, categoryId: sedanCat?.id, officeId: headOffice.id, grnNumber: 'GRN-001-2024', registrationNumber: 'N 12345 KER', make: 'Toyota', model: 'Corolla', year: 2023, colour: 'White', bodyType: 'Sedan', fuelType: 'petrol', transmission: 'manual', currentOdometer: 45230, status: 'available' },
    { tenantId: TENANT_ID as any, categoryId: sedanCat?.id, officeId: headOffice.id, grnNumber: 'GRN-002-2024', registrationNumber: 'N 12346 KER', make: 'Nissan', model: 'Sentra', year: 2023, colour: 'Silver', bodyType: 'Sedan', fuelType: 'petrol', transmission: 'manual', currentOdometer: 38900, status: 'available' },
    { tenantId: TENANT_ID as any, categoryId: bakkieDCCat?.id, officeId: headOffice.id, grnNumber: 'GRN-003-2024', registrationNumber: 'N 23456 KER', make: 'Toyota', model: 'Hilux Double Cab', year: 2024, colour: 'White', bodyType: 'Bakkie', fuelType: 'diesel', transmission: 'manual', currentOdometer: 18200, status: 'available' },
    { tenantId: TENANT_ID as any, categoryId: bakkieDCCat?.id, officeId: headOffice.id, grnNumber: 'GRN-004-2024', registrationNumber: 'N 23457 KER', make: 'Ford', model: 'Ranger Double Cab', year: 2024, colour: 'Blue', bodyType: 'Bakkie', fuelType: 'diesel', transmission: 'automatic', currentOdometer: 25600, status: 'maintenance' },
    { tenantId: TENANT_ID as any, categoryId: bakkieDCCat?.id, officeId: constituencyOffices[0].id, grnNumber: 'GRN-005-2024', registrationNumber: 'N 34567 KER', make: 'Toyota', model: 'Hilux Double Cab', year: 2023, colour: 'White', bodyType: 'Bakkie', fuelType: 'diesel', transmission: 'manual', currentOdometer: 32100, status: 'available' },
  ]);

  // 11. Create workflow definitions
  console.log('Creating workflow definitions...');
  const [regionalDef] = await db.insert(workflowDefinitions)
    .values({ tenantId: TENANT_ID as any, tripScope: 'regional', name: 'Regional Trip Workflow', isActive: true })
    .returning();

  const [nationalDef] = await db.insert(workflowDefinitions)
    .values({ tenantId: TENANT_ID as any, tripScope: 'national', name: 'National Trip Workflow', isActive: true })
    .returning();

  await db.insert(workflowSteps).values([
    { definitionId: regionalDef.id, stepOrder: 1, actionType: 'supervisor_approve', requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR, label: 'Supervisor Approval', allowsEmergencyOverride: false },
    { definitionId: regionalDef.id, stepOrder: 2, actionType: 'transport_review', requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT, label: 'Transport Review', allowsEmergencyOverride: false },
    { definitionId: regionalDef.id, stepOrder: 3, actionType: 'release', requiredPermission: Permissions.VEHICLE_RELEASE_REGIONAL, label: 'Administrative Release', allowsEmergencyOverride: true },
    { definitionId: regionalDef.id, stepOrder: 4, actionType: 'authorise', requiredPermission: Permissions.TRIP_AUTHORIZE_REGIONAL, label: 'Final Authorisation', allowsEmergencyOverride: true, separationDutyRole: 'release' },
    { definitionId: regionalDef.id, stepOrder: 5, actionType: 'acknowledge', requiredPermission: Permissions.DRIVER_LOG_CREATE, label: 'Driver Acknowledgement', allowsEmergencyOverride: false },
  ]);

  await db.insert(workflowSteps).values([
    { definitionId: nationalDef.id, stepOrder: 1, actionType: 'supervisor_approve', requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR, label: 'Supervisor Approval', allowsEmergencyOverride: false },
    { definitionId: nationalDef.id, stepOrder: 2, actionType: 'transport_review', requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT, label: 'Transport Review', allowsEmergencyOverride: false },
    { definitionId: nationalDef.id, stepOrder: 3, actionType: 'release', requiredPermission: Permissions.VEHICLE_RELEASE_NATIONAL, label: 'Director Release', allowsEmergencyOverride: true },
    { definitionId: nationalDef.id, stepOrder: 4, actionType: 'authorise', requiredPermission: Permissions.TRIP_AUTHORIZE_NATIONAL, label: 'CRO Authorisation', allowsEmergencyOverride: true, separationDutyRole: 'release' },
    { definitionId: nationalDef.id, stepOrder: 5, actionType: 'acknowledge', requiredPermission: Permissions.DRIVER_LOG_CREATE, label: 'Driver Acknowledgement', allowsEmergencyOverride: false },
  ]);

  // 12. Create login accounts
  console.log('Creating login accounts...');
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'changeme';
  const adminUserId = 'user-seed-admin-001';

  // Hash the password for Better Auth's account table
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Insert Better Auth user record
  await db.insert(user).values({
    id: adminUserId,
    email: adminEmail,
    emailVerified: true,
    name: 'Kandjimi Amupanda',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  // Insert Better Auth account record with password hash
  await db.insert(account).values({
    id: 'acc-seed-admin-001',
    accountId: adminEmail,
    providerId: 'email',
    userId: adminUserId,
    password: passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  // Create tenant membership linking admin to Kavango East
  await db.insert(tenantMemberships).values({
    tenantId: TENANT_ID as any,
    userId: adminUserId,
    status: 'active',
  }).onConflictDoNothing();

  console.log('✅ Seed complete!');
  console.log('   Tenant: Kavango East Regional Council');
  console.log('   Employees: 10 created');
  console.log('   Login accounts: 1 admin created');
  console.log(`     Email:    ${adminEmail}`);
  console.log(`     Password: ${adminPassword}`);
  console.log('   Vehicles: 5 (3 available, 1 in maintenance, 1 at constituency)');
  console.log('   Roles: 9 default roles with permissions');
  console.log('   Workflows: Regional and National');
}

seed()
  .catch((e: unknown) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
