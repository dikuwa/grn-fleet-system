/**
 * Minimal Test Data Seed
 *
 * Ensures a small, intentional baseline exists after a development data
 * reset so the full workflow can be exercised from a clean state:
 *
 *   new transport request → approval chain → vehicle/driver allocation →
 *   trip authority → departure → driver reporting → return → documents.
 *
 * It ONLY creates/verifies baseline identities (tenant, offices,
 * departments, roles, permissions, staff, driver profiles, licences,
 * vehicle categories, vehicles, workflow definitions, inspection
 * templates, login accounts, one programme). It never creates requests,
 * trips, documents, notifications, expenses, inspections or maintenance
 * events.
 *
 * Every operation is idempotent: existing records are never duplicated and
 * nothing is deleted.
 *
 * Run: pnpm seed:minimal-test-data
 */
import { getDb } from '@/db';
import {
  tenants,
  tenantBranding,
  tenantMemberships,
  roles,
  permissions,
  rolePermissions,
  roleAssignments,
  offices,
  departments,
  employees,
  driverProfiles,
  driverLicences,
  vehicleCategories,
  vehicles,
  workflowDefinitions,
  workflowSteps,
  inspectionTemplates,
  inspectionTemplateItems,
  user,
  account,
  userProfiles,
  programmes,
} from '@/db/schema';
import { Permissions, RoleDefinitions } from '@/lib/permissions';
import {
  DEPARTURE_INSPECTION_ITEMS,
  RETURN_INSPECTION_ITEMS,
  type DefaultInspectionItem,
} from '@/lib/inspection-checklists';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const OFFICES: Array<{ name: string; type: 'head_office' | 'constituency_office' | 'settlement_office'; code: string }> = [
  { name: 'Head Office — Rundu', type: 'head_office', code: 'HOR' },
  { name: 'Rundu Urban Constituency Office', type: 'constituency_office', code: 'RUO' },
  { name: 'Rundu Rural West Constituency Office', type: 'constituency_office', code: 'RRW' },
  { name: 'Rundu Rural East Constituency Office', type: 'constituency_office', code: 'RRE' },
  { name: 'Mukwe Constituency Office', type: 'constituency_office', code: 'MKO' },
  { name: 'Kapako Constituency Office', type: 'constituency_office', code: 'KPO' },
  { name: 'Mashare Constituency Office', type: 'constituency_office', code: 'MSO' },
];

const DEPARTMENTS: Array<{ name: string; code: string; type: string }> = [
  { name: 'Human Resources, Finance and Administration', code: 'HRFA', type: 'directorate' },
  { name: 'Rural Services and Community Development', code: 'RSCD', type: 'directorate' },
  { name: 'Office of the Chief Regional Officer', code: 'CRO', type: 'unit' },
  { name: 'Transport and Fleet Management', code: 'TFM', type: 'unit' },
  { name: 'Administration and Finance', code: 'ADM', type: 'department' },
  { name: 'Community Development', code: 'CD', type: 'department' },
];

const STAFF: Array<{
  empNo: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  dept: string;
  office: string;
  isDriver: boolean;
}> = [
  { empNo: 'KERC001', firstName: 'Kandjimi', lastName: 'Amupanda', jobTitle: 'Tenant Administrator', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
  { empNo: 'KERC002', firstName: 'Maria', lastName: 'Shikongo', jobTitle: 'Programme Officer', dept: 'Community Development', office: 'Rundu Urban Constituency Office', isDriver: false },
  { empNo: 'KERC003', firstName: 'Petrus', lastName: 'Ndara', jobTitle: 'Supervisor', dept: 'Community Development', office: 'Rundu Urban Constituency Office', isDriver: false },
  { empNo: 'KERC004', firstName: 'Erastus', lastName: 'Hausiku', jobTitle: 'Control Administrative Officer', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
  { empNo: 'KERC005', firstName: 'Loide', lastName: 'Kandjiri', jobTitle: 'Deputy Director', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
  { empNo: 'KERC006', firstName: 'Tomas', lastName: 'Sikongo', jobTitle: 'Director', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
  { empNo: 'KERC007', firstName: 'Rafael', lastName: 'Kasume', jobTitle: 'Chief Regional Officer', dept: 'Office of the Chief Regional Officer', office: 'Head Office — Rundu', isDriver: false },
  { empNo: 'KERC008', firstName: 'Michael', lastName: 'Mwala', jobTitle: 'Driver', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: true },
  { empNo: 'KERC009', firstName: 'Selma', lastName: 'Nangula', jobTitle: 'Driver', dept: 'Transport and Fleet Management', office: 'Rundu Urban Constituency Office', isDriver: true },
  { empNo: 'KERC011', firstName: 'Ndapewa', lastName: 'Hamutenya', jobTitle: 'Transport Administrator', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: false },
];

const VEHICLES: Array<{ licenceNumber: string; registerNumber: string; make: string; model: string; categoryCode: string; fuelType: string }> = [
  { licenceNumber: 'GRN-001-2024', registerNumber: 'N 12345 KER', make: 'Toyota', model: 'Corolla', categoryCode: 'SEDAN', fuelType: 'petrol' },
  { licenceNumber: 'GRN-002-2024', registerNumber: 'N 12346 KER', make: 'Nissan', model: 'Sentra', categoryCode: 'SEDAN', fuelType: 'petrol' },
  { licenceNumber: 'GRN-003-2024', registerNumber: 'N 23456 KER', make: 'Toyota', model: 'Hilux Double Cab', categoryCode: 'BAKKIE_DC', fuelType: 'diesel' },
  { licenceNumber: 'GRN-005-2024', registerNumber: 'N 34567 KER', make: 'Toyota', model: 'Hilux Double Cab', categoryCode: 'BAKKIE_DC', fuelType: 'diesel' },
];

const LOGIN_ACCOUNTS: Array<{ key: string; email: string; name: string; empNo: string; roleName: string }> = [
  { key: 'tenant-admin', email: process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na', name: 'Kandjimi Amupanda', empNo: 'KERC001', roleName: RoleDefinitions.TENANT_ADMIN.name },
  { key: 'transport-admin', email: 'transport.admin@kavangoeast.test', name: 'Ndapewa Hamutenya', empNo: 'KERC011', roleName: RoleDefinitions.TRANSPORT_ADMIN.name },
  { key: 'requester', email: 'requester@kavangoeast.test', name: 'Maria Shikongo', empNo: 'KERC002', roleName: RoleDefinitions.REQUESTER.name },
  { key: 'supervisor', email: 'supervisor@kavangoeast.test', name: 'Petrus Ndara', empNo: 'KERC003', roleName: RoleDefinitions.SUPERVISOR.name },
  { key: 'release-officer', email: 'release.officer@kavangoeast.test', name: 'Erastus Hausiku', empNo: 'KERC004', roleName: RoleDefinitions.CONTROL_ADMIN_OFFICER.name },
  { key: 'regional-authoriser', email: 'regional.authoriser@kavangoeast.test', name: 'Loide Kandjiri', empNo: 'KERC005', roleName: RoleDefinitions.DEPUTY_DIRECTOR.name },
  { key: 'national-release', email: 'national.release@kavangoeast.test', name: 'Tomas Sikongo', empNo: 'KERC006', roleName: RoleDefinitions.DIRECTOR.name },
  { key: 'national-authoriser', email: 'national.authoriser@kavangoeast.test', name: 'Rafael Kasume', empNo: 'KERC007', roleName: RoleDefinitions.CHIEF_REGIONAL_OFFICER.name },
  { key: 'driver', email: 'driver@kavangoeast.test', name: 'Michael Mwala', empNo: 'KERC008', roleName: RoleDefinitions.DRIVER.name },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

async function ensureBaseline() {
  const db = getDb() as AnyDb;
  const tenantId = TENANT_ID;

  // 1. Tenant + branding
  await db.insert(tenants)
    .values({
      id: tenantId,
      name: 'Kavango East Regional Council',
      code: 'KERC',
      slug: 'kavango-east',
      type: 'regional_council',
      status: 'ACTIVE',
    })
    .onConflictDoNothing();
  const [branding] = await db.select({ id: tenantBranding.id }).from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
  if (!branding) {
    await db.insert(tenantBranding).values({ tenantId, contactEmail: 'transport@kavangoeast.gov.na', contactPhone: '+264 66 123 456', address: 'Government Building, Rundu, Namibia', documentFooter: 'Kavango East Regional Council — Fleet Management', senderName: 'Kavango East Transport', senderEmail: 'transport@kavangoeast.gov.na' });
  }

  // 2. Offices + departments (idempotent)
  const officeIds: Record<string, string> = {};
  for (const office of OFFICES) {
    const [existing] = await db.select({ id: offices.id }).from(offices).where(and(eq(offices.tenantId, tenantId), eq(offices.code, office.code))).limit(1);
    if (existing) officeIds[office.name] = existing.id;
    else {
      const [created] = await db.insert(offices).values({ tenantId, name: office.name, type: office.type, code: office.code }).returning();
      officeIds[office.name] = created.id;
    }
  }

  const departmentIds: Record<string, string> = {};
  for (const dept of DEPARTMENTS) {
    const [existing] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.tenantId, tenantId), eq(departments.code, dept.code))).limit(1);
    if (existing) departmentIds[dept.name] = existing.id;
    else {
      const [created] = await db.insert(departments).values({ tenantId, name: dept.name, code: dept.code, type: dept.type }).returning();
      departmentIds[dept.name] = created.id;
    }
  }

  // 3. Permissions + roles (idempotent)
  for (const code of Object.values(Permissions)) {
    await db.insert(permissions).values({ code, name: code.replace(/[:-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), description: `Permission to ${code.replace(/[:-]/g, ' ')}`, group: code.split(':')[0] }).onConflictDoNothing();
  }

  const roleNames = [
    RoleDefinitions.TENANT_ADMIN.name,
    RoleDefinitions.PLATFORM_SUPER_ADMIN.name,
    RoleDefinitions.PLATFORM_SUPPORT.name,
    RoleDefinitions.PLATFORM_AUDITOR.name,
    RoleDefinitions.TRANSPORT_ADMIN.name,
    RoleDefinitions.REQUESTER.name,
    RoleDefinitions.SUPERVISOR.name,
    RoleDefinitions.CONTROL_ADMIN_OFFICER.name,
    RoleDefinitions.DEPUTY_DIRECTOR.name,
    RoleDefinitions.DIRECTOR.name,
    RoleDefinitions.CHIEF_REGIONAL_OFFICER.name,
    RoleDefinitions.DRIVER.name,
    RoleDefinitions.INSPECTOR.name,
    RoleDefinitions.MAINTENANCE_OFFICER.name,
    RoleDefinitions.TENANT_AUDITOR.name,
  ];

  const roleIds: Record<string, string> = {};
  const roleWasCreated: Record<string, boolean> = {};
  for (const roleName of roleNames) {
    const [existing] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.name, roleName))).limit(1);
    if (existing) {
      roleIds[roleName] = existing.id;
      roleWasCreated[roleName] = false;
    } else {
      const [created] = await db.insert(roles).values({ tenantId, name: roleName, isSystem: true }).returning();
      roleIds[roleName] = created.id;
      roleWasCreated[roleName] = true;
    }
  }

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
    [RoleDefinitions.CHIEF_REGIONAL_OFFICER.name]: RoleDefinitions.CHIEF_REGIONAL_OFFICER.permissions,
    [RoleDefinitions.DRIVER.name]: RoleDefinitions.DRIVER.permissions,
    [RoleDefinitions.INSPECTOR.name]: RoleDefinitions.INSPECTOR.permissions,
    [RoleDefinitions.MAINTENANCE_OFFICER.name]: RoleDefinitions.MAINTENANCE_OFFICER.permissions,
    [RoleDefinitions.TENANT_AUDITOR.name]: RoleDefinitions.TENANT_AUDITOR.permissions,
  };
  // Only seed default permissions onto roles this script created. Existing
  // roles may carry custom permission mappings — never clobber them.
  for (const [roleName, perms] of Object.entries(rolePermMap)) {
    const roleId = roleIds[roleName];
    if (!roleId || !roleWasCreated[roleName]) continue;
    const existingPermissions = (await db
      .select({ permissionCode: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId))) as Array<{ permissionCode: string }>;
    const existingCodes = new Set(existingPermissions.map((row) => row.permissionCode));
    const missing = perms.filter((permissionCode) => !existingCodes.has(permissionCode));
    if (missing.length > 0) {
      await db.insert(rolePermissions).values(missing.map((permissionCode) => ({ roleId, permissionCode })));
    }
  }

  // 4. Staff (idempotent by employee number)
  const employeeIds: Record<string, string> = {};
  for (const staff of STAFF) {
    const email = `${staff.firstName.toLowerCase()}.${staff.lastName.toLowerCase()}@kavangoeast.test`;
    const [existing] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.employeeNumber, staff.empNo))).limit(1);
    if (existing) {
      // Never overwrite an existing (possibly legitimate) staff record.
      employeeIds[staff.empNo] = existing.id;
    } else {
      const [created] = await db.insert(employees).values({ tenantId, employeeNumber: staff.empNo, firstName: staff.firstName, lastName: staff.lastName, jobTitle: staff.jobTitle, departmentId: departmentIds[staff.dept], officeId: officeIds[staff.office], email, phone: '+264 81 000 0000', employmentStatus: 'active', isDriver: staff.isDriver }).returning();
      employeeIds[staff.empNo] = created.id;
    }
  }

  // 5. Driver profiles + licences
  for (const staff of STAFF.filter((s) => s.isDriver)) {
    const employeeId = employeeIds[staff.empNo];
    if (!employeeId) continue;
    let [profile] = await db.select({ id: driverProfiles.id }).from(driverProfiles).where(eq(driverProfiles.employeeId, employeeId)).limit(1);
    if (!profile) {
      [profile] = await db.insert(driverProfiles).values({ employeeId, driverStatus: 'authorised', availabilityStatus: 'available' }).returning({ id: driverProfiles.id });
    }
    const [licence] = await db.select({ id: driverLicences.id }).from(driverLicences).where(eq(driverLicences.driverProfileId, profile.id)).limit(1);
    if (!licence) {
      await db.insert(driverLicences).values({ driverProfileId: profile.id, licenceNumber: `LIC-${staff.empNo}`, licenceClass: 'B', issueDate: '2023-01-01', expiryDate: '2028-12-31', isVerified: true, verificationStatus: 'verified' });
    }
  }

  // 6. Vehicle categories + vehicles (idempotent by licence number)
  const categoryIds: Record<string, string> = {};
  for (const category of [
    { code: 'SEDAN', name: 'Sedan', passengerCapacity: 5 },
    { code: 'BAKKIE_DC', name: 'Bakkie (Double Cab)', passengerCapacity: 5 },
  ]) {
    const [existing] = await db.select({ id: vehicleCategories.id }).from(vehicleCategories).where(and(eq(vehicleCategories.tenantId, tenantId), eq(vehicleCategories.code, category.code))).limit(1);
    if (existing) categoryIds[category.code] = existing.id;
    else {
      const [created] = await db.insert(vehicleCategories).values({ tenantId, name: category.name, code: category.code, passengerCapacity: category.passengerCapacity }).returning();
      categoryIds[category.code] = created.id;
    }
  }

  for (const vehicle of VEHICLES) {
    const [existing] = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.licenceNumber, vehicle.licenceNumber))).limit(1);
    if (!existing) {
      await db.insert(vehicles).values({ tenantId, licenceNumber: vehicle.licenceNumber, vehicleRegisterNumber: vehicle.registerNumber, make: vehicle.make, model: vehicle.model, categoryId: categoryIds[vehicle.categoryCode], officeId: officeIds['Head Office — Rundu'], fuelType: vehicle.fuelType, currentOdometer: 1000, status: 'available' });
    }
  }

  // 7. Workflow definitions + steps (idempotent)
  const regionalStepLabels = [
    { stepOrder: 1, actionType: 'supervisor_approve', requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR, label: 'Supervisor Approval' },
    { stepOrder: 2, actionType: 'transport_review', requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT, label: 'Transport Review' },
    { stepOrder: 3, actionType: 'release', requiredPermission: Permissions.VEHICLE_RELEASE_REGIONAL, label: 'Administrative Release' },
    { stepOrder: 4, actionType: 'authorise', requiredPermission: Permissions.TRIP_AUTHORIZE_REGIONAL, label: 'Final Authorisation', separationDutyRole: 'release' },
    { stepOrder: 5, actionType: 'acknowledge', requiredPermission: Permissions.DRIVER_LOG_CREATE, label: 'Driver Acknowledgement' },
  ];
  for (const workflow of [
    { name: 'Regional Trip Workflow', tripScope: 'regional', steps: regionalStepLabels },
  ]) {
    let [definition] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.name, workflow.name))).limit(1);
    if (!definition) {
      [definition] = await db.insert(workflowDefinitions).values({ tenantId, tripScope: workflow.tripScope, name: workflow.name, isActive: true }).returning({ id: workflowDefinitions.id });
    }
    await db.delete(workflowSteps).where(eq(workflowSteps.definitionId, definition.id));
    await db.insert(workflowSteps).values(workflow.steps.map((step) => ({ definitionId: definition.id, ...step })));
  }

  // 8. Inspection templates (idempotent)
  const templateSeeds: Array<{
    type: 'departure' | 'return';
    name: string;
    items: DefaultInspectionItem[];
  }> = [
    { type: 'departure', name: 'Standard Departure Inspection', items: DEPARTURE_INSPECTION_ITEMS },
    { type: 'return', name: 'Standard Return Inspection', items: RETURN_INSPECTION_ITEMS },
  ];
  for (const templateSeed of templateSeeds) {
    let [template] = await db.select({ id: inspectionTemplates.id }).from(inspectionTemplates).where(and(eq(inspectionTemplates.tenantId, tenantId), eq(inspectionTemplates.type, templateSeed.type), eq(inspectionTemplates.isActive, true))).limit(1);
    if (!template) {
      [template] = await db.insert(inspectionTemplates).values({ tenantId, name: templateSeed.name, type: templateSeed.type, version: 1, isActive: true }).returning({ id: inspectionTemplates.id });
    }
    const existingItems = (await db.select({ label: inspectionTemplateItems.label }).from(inspectionTemplateItems).where(eq(inspectionTemplateItems.templateId, template.id))) as Array<{ label: string }>;
    const existingLabels = new Set(existingItems.map((item) => item.label));
    const missing = templateSeed.items.filter((item) => !existingLabels.has(item.label));
    if (missing.length > 0) {
      await db.insert(inspectionTemplateItems).values(missing.map((item, index) => ({ ...item, templateId: template.id, sortOrder: index + 1 })));
    }
  }

  // 9. Login accounts (idempotent; never duplicates)
  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'changeme', 10);
  for (const login of LOGIN_ACCOUNTS) {
    const [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, login.email)).limit(1);
    const userId = existingUser?.id ?? `user-seed-${login.key}`;
    if (!existingUser) {
      await db.insert(user).values({ id: userId, email: login.email, username: login.key, emailVerified: true, name: login.name, createdAt: new Date(), updatedAt: new Date() });
    }
    const [existingProfile] = await db.select({ id: userProfiles.id }).from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    if (!existingProfile) {
      await db.insert(userProfiles).values({ id: userId, userId, displayName: login.name, requiresPasswordChange: false, status: 'active' });
    }
    const [existingAccount] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, 'email'))).limit(1);
    if (!existingAccount) {
      await db.insert(account).values({ id: `account-seed-${login.key}`, accountId: login.email, providerId: 'email', userId, password: passwordHash, createdAt: new Date(), updatedAt: new Date() });
    }
    let [membership] = await db.select({ id: tenantMemberships.id }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId))).limit(1);
    if (!membership) {
      [membership] = await db.insert(tenantMemberships).values({ tenantId, userId, status: 'active' }).returning({ id: tenantMemberships.id });
    }
    const employeeId = employeeIds[login.empNo];
    if (employeeId) {
      await db.update(employees).set({ userId, email: login.email }).where(eq(employees.id, employeeId));
    }
    const roleId = roleIds[login.roleName];
    if (roleId) {
      const [assignment] = await db.select({ id: roleAssignments.id }).from(roleAssignments).where(eq(roleAssignments.tenantMembershipId, membership.id)).limit(1);
      if (!assignment) {
        await db.insert(roleAssignments).values({ tenantMembershipId: membership.id, roleId });
      }
    }
  }

  // 10. One programme of activities (idempotent by reference + title)
  const [existingProgramme] = await db.select({ id: programmes.id }).from(programmes).where(and(eq(programmes.tenantId, tenantId), eq(programmes.title, 'Baseline Community Outreach Programme'))).limit(1);
  if (!existingProgramme) {
    await db.insert(programmes).values({
      tenantId,
      reference: 'PRG/BASELINE/001',
      title: 'Baseline Community Outreach Programme',
      description: 'Clean baseline programme for end-to-end workflow testing.',
      purpose: 'Exercise transport request and trip workflows from a clean state.',
      departmentId: departmentIds['Community Development'] ?? null,
      officeId: officeIds['Rundu Urban Constituency Office'] ?? null,
      status: 'published',
      createdByUserId: 'seed-system',
      submittedAt: new Date(),
      approvedAt: new Date(),
      publishedAt: new Date(),
    });
  }

  console.log('✅ Minimal baseline ensured — no operational transactions created.');
  console.log(`   Staff: ${STAFF.length}, Vehicles: ${VEHICLES.length}, Login accounts: ${LOGIN_ACCOUNTS.length}`);
  console.log('   Next: create a new transport request via the dashboard.');
}

ensureBaseline()
  .catch((error: unknown) => {
    console.error('❌ Minimal seed failed:', error);
    process.exit(1);
  })
  .then(() => process.exit(0));
