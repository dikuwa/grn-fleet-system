/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Development Seed Data
 *
 * Creates Kavango East tenant with offices, departments, employees,
 * vehicle categories, vehicles, roles, permissions, workflow definitions,
 * driver profiles, driver licences, and login accounts.
 *
 * All operations are idempotent — safe to re-run.
 *
 * Run: pnpm db:seed
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
  departmentOffices,
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
} from '@/db/schema';
import { Permissions, RoleDefinitions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { DEPARTURE_INSPECTION_ITEMS, RETURN_INSPECTION_ITEMS } from '@/lib/inspection-checklists';
import { normaliseEmployeeStatus } from '@/lib/employee-status';
import { recordAuditEvent } from '@/lib/audit-event';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ISOLATION_TENANT_ID = '00000000-0000-0000-0000-000000000002';

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

  // -------------------------------------------------------------------------
  // 1. Tenant (idempotent)
  // -------------------------------------------------------------------------
  console.log('Creating tenant...');
  await db.insert(tenants)
    .values({
      id: TENANT_ID as any,
      name: 'Kavango East Regional Council',
      code: 'KERC',
      slug: 'kavango-east',
      type: 'regional_council',
      status: 'ACTIVE',
      planCode: 'INTERNAL_DEFAULT',
      subscriptionStatus: 'NOT_CONFIGURED',
      // Explicit onboarding lifecycle: ACTIVE so the session entitlement gate
      // (canTenantOperate) never blocks this existing tenant.
      lifecycleStatus: 'ACTIVE',
      timezone: 'Africa/Windhoek',
      locale: 'en-NA',
    })
    .onConflictDoNothing();

  // -------------------------------------------------------------------------
  // 2. Tenant branding (idempotent)
  // -------------------------------------------------------------------------
  const [existingBranding] = await db
    .select({ id: tenantBranding.id })
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, TENANT_ID as any))
    .limit(1);

  if (!existingBranding) {
    await db.insert(tenantBranding).values({
      tenantId: TENANT_ID as any,
      contactEmail: 'transport@kavangoeast.gov.na',
      contactPhone: '+264 66 123 456',
      address: 'Government Building, Rundu, Namibia',
      documentFooter: 'Kavango East Regional Council — Fleet Management',
      senderName: 'Kavango East Transport',
      senderEmail: 'transport@kavangoeast.gov.na',
    });
  }

  // -------------------------------------------------------------------------
  // 3. Offices (idempotent)
  // -------------------------------------------------------------------------
  console.log('Creating offices...');
  const officeDataList = [
    { tenantId: TENANT_ID as any, name: 'Head Office — Rundu', type: 'head_office' as const, code: 'HOR', address: 'Rundu, Kavango East', email: 'info@kavangoeast.gov.na', phone: '+264 66 123 400', latitude: -17.9255, longitude: 19.753 },
    { tenantId: TENANT_ID as any, name: 'Rundu Urban Constituency Office', type: 'constituency_office' as const, code: 'RUO', latitude: -17.9167, longitude: 19.7667 },
    { tenantId: TENANT_ID as any, name: 'Rundu Rural West Constituency Office', type: 'constituency_office' as const, code: 'RRW', latitude: -17.9333, longitude: 19.6833 },
    { tenantId: TENANT_ID as any, name: 'Rundu Rural East Constituency Office', type: 'constituency_office' as const, code: 'RRE', latitude: -17.9667, longitude: 19.8 },
    { tenantId: TENANT_ID as any, name: 'Mukwe Constituency Office', type: 'constituency_office' as const, code: 'MKO', latitude: -18.0667, longitude: 21.4167 },
    { tenantId: TENANT_ID as any, name: 'Kapako Constituency Office', type: 'constituency_office' as const, code: 'KPO', latitude: -17.8833, longitude: 19.8333 },
    { tenantId: TENANT_ID as any, name: 'Mashare Constituency Office', type: 'constituency_office' as const, code: 'MSO', latitude: -17.95, longitude: 20.0667 },
    { tenantId: TENANT_ID as any, name: 'Ndonga-Linena Constituency Office', type: 'constituency_office' as const, code: 'NLO' },
    { tenantId: TENANT_ID as any, name: 'Ndiyona Constituency Office', type: 'constituency_office' as const, code: 'NDO' },
    { tenantId: TENANT_ID as any, name: 'Rundu Rural Constituency Office', type: 'constituency_office' as const, code: 'RRO' },
    { tenantId: TENANT_ID as any, name: 'Nkurenkuru Settlement Office', type: 'settlement_office' as const, code: 'NKO', latitude: -17.6167, longitude: 18.6 },
  ];

  const existingOffices = await db
    .select({ name: offices.name, id: offices.id })
    .from(offices)
    .where(eq(offices.tenantId, TENANT_ID as any));
  const existingOfficeMap: Record<string, string> = {};
  for (const o of existingOffices) {
    existingOfficeMap[o.name] = o.id;
  }

  const officeMap: Record<string, string> = {};
  for (const od of officeDataList) {
    const found = existingOfficeMap[od.name];
    if (found) {
      officeMap[od.name] = found;
    } else {
      const [created] = await db.insert(offices).values(od).returning();
      officeMap[created.name] = created.id;
    }
  }

  const headOfficeId = officeMap['Head Office — Rundu'];

  // Set parent for child offices (only on newly created ones)
  for (const od of officeDataList) {
    if (od.type === 'constituency_office' || od.type === 'settlement_office') {
      const oid = officeMap[od.name];
      if (oid && !existingOfficeMap[od.name]) {
        await db.update(offices).set({ parentId: headOfficeId }).where(eq(offices.id, oid));
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Departments (idempotent)
  // -------------------------------------------------------------------------
  console.log('Creating departments...');
  const deptDataList = [
    { name: 'Human Resources, Finance and Administration', code: 'HRFA', type: 'directorate', parentName: null },
    { name: 'Planning, Monitoring and Evaluation', code: 'PME', type: 'directorate', parentName: null },
    { name: 'Rural Services and Community Development', code: 'RSCD', type: 'directorate', parentName: null },
    { name: 'Office of the Chief Regional Officer', code: 'CRO', type: 'unit', parentName: null },
    { name: 'Internal Audit', code: 'IA', type: 'unit', parentName: null },
    { name: 'Public Relations and Communications', code: 'PRC', type: 'unit', parentName: null },
    { name: 'Transport and Fleet Management', code: 'TFM', type: 'unit', parentName: null },
    { name: 'Administration', code: 'ADMIN', type: 'department', parentName: 'Human Resources, Finance and Administration' },
    { name: 'Human Resources', code: 'HR', type: 'department', parentName: 'Human Resources, Finance and Administration' },
    { name: 'Finance', code: 'FIN', type: 'department', parentName: 'Human Resources, Finance and Administration' },
    { name: 'General Services', code: 'GS', type: 'unit', parentName: 'Human Resources, Finance and Administration' },
    { name: 'Information Technology', code: 'IT', type: 'unit', parentName: 'Human Resources, Finance and Administration' },
    { name: 'Engineering and Technical Services', code: 'ETS', type: 'unit', parentName: 'Planning, Monitoring and Evaluation' },
    // Existing demo units are retained because seeded staff and historical records reference them.
    { name: 'Administration and Finance', code: 'ADM', type: 'department', parentName: null },
    { name: 'Community Development', code: 'CD', type: 'department', parentName: 'Rural Services and Community Development' },
    { name: 'Infrastructure and Planning', code: 'INP', type: 'department', parentName: 'Planning, Monitoring and Evaluation' },
  ];

  const deptMap: Record<string, string> = {};
  for (const dd of deptDataList) {
    const [existing] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, TENANT_ID as any), eq(departments.name, dd.name)))
      .limit(1);
    if (existing) {
      deptMap[dd.name] = existing.id;
    } else {
      const [created] = await db.insert(departments).values({
        tenantId: TENANT_ID as any,
        name: dd.name,
        code: dd.code,
        type: dd.type,
        parentId: dd.parentName ? deptMap[dd.parentName] : null,
      }).returning();
      deptMap[created.name] = created.id;
    }
  }

  // -------------------------------------------------------------------------
  // 5. Permissions (idempotent)
  // -------------------------------------------------------------------------
  console.log('Creating permissions...');
  const allPermissionCodes = Object.values(Permissions);
  for (const code of allPermissionCodes) {
    await db.insert(permissions).values({
      code,
      name: code.replace(/[:-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      description: `Permission to ${code.replace(/[:-]/g, ' ')}`,
      group: code.split(':')[0],
    }).onConflictDoNothing();
  }

  // -------------------------------------------------------------------------
  // 6. Roles (idempotent)
  // -------------------------------------------------------------------------
  console.log('Creating roles...');
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

  const roleRecords: Array<{ id: string; name: string }> = [];
  for (const roleName of roleNames) {
    const [existing] = await db
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(and(eq(roles.tenantId, TENANT_ID as any), eq(roles.name, roleName)))
      .limit(1);
    if (existing) {
      roleRecords.push(existing);
    } else {
      const [created] = await db
        .insert(roles)
        .values({ tenantId: TENANT_ID as any, name: roleName, isSystem: true })
        .returning();
      roleRecords.push(created);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Role-Permission mappings (sync — idempotent via delete+insert)
  // -------------------------------------------------------------------------
  console.log('Assigning role permissions...');
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

  // -------------------------------------------------------------------------
  // 8. Employees (idempotent by employeeNumber)
  // -------------------------------------------------------------------------
  console.log('Creating employees...');
  const staffData: StaffRow[] = [
    { empNo: 'KERC001', title: 'Mr', firstName: 'Kandjimi', lastName: 'Amupanda', jobTitle: 'Tenant Administrator', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC002', title: 'Ms', firstName: 'Maria', lastName: 'Shikongo', jobTitle: 'Programme Officer', dept: 'Community Development', office: 'Rundu Urban Constituency Office', isDriver: false },
    { empNo: 'KERC003', title: 'Mr', firstName: 'Petrus', lastName: 'Ndara', jobTitle: 'Supervisor', dept: 'Community Development', office: 'Rundu Urban Constituency Office', isDriver: false },
    { empNo: 'KERC004', title: 'Mr', firstName: 'Erastus', lastName: 'Hausiku', jobTitle: 'Control Administrative Officer', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC005', title: 'Ms', firstName: 'Loide', lastName: 'Kandjiri', jobTitle: 'Deputy Director', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC006', title: 'Mr', firstName: 'Tomas', lastName: 'Sikongo', jobTitle: 'Director', dept: 'Infrastructure and Planning', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC007', title: 'Mr', firstName: 'Rafael', lastName: 'Kasume', jobTitle: 'Chief Regional Officer', dept: 'Office of the Chief Regional Officer', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC008', title: 'Mr', firstName: 'Michael', lastName: 'Mwala', jobTitle: 'Driver', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: true },
    { empNo: 'KERC009', title: 'Ms', firstName: 'Selma', lastName: 'Nangula', jobTitle: 'Driver', dept: 'Transport and Fleet Management', office: 'Rundu Urban Constituency Office', isDriver: true },
    { empNo: 'KERC010', title: 'Mr', firstName: 'Johannes', lastName: 'Shivute', jobTitle: 'Tenant Auditor', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC011', title: 'Ms', firstName: 'Ndapewa', lastName: 'Hamutenya', jobTitle: 'Transport Administrator', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC012', title: 'Mr', firstName: 'Tangeni', lastName: 'Ndeitunga', jobTitle: 'Vehicle Inspector', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC013', title: 'Ms', firstName: 'Hilma', lastName: 'Nakashole', jobTitle: 'Maintenance Officer', dept: 'Transport and Fleet Management', office: 'Head Office — Rundu', isDriver: false },
    { empNo: 'KERC014', title: 'Ms', firstName: 'Paulus', lastName: 'Platform', jobTitle: 'Platform Systems Administrator', dept: 'Administration and Finance', office: 'Head Office — Rundu', isDriver: false },
  ];

  const employeeIdMap: Record<string, string> = {};
  for (const s of staffData) {
    const empEmail = `${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@kavangoeast.test`;
    const [existingEmp] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, TENANT_ID as any), eq(employees.employeeNumber, s.empNo)))
      .limit(1);

    if (existingEmp) {
      employeeIdMap[s.empNo] = existingEmp.id;
      await db.update(employees).set({
        title: s.title,
        firstName: s.firstName,
        lastName: s.lastName,
        jobTitle: s.jobTitle,
        departmentId: s.dept ? deptMap[s.dept] : null,
        officeId: s.office ? officeMap[s.office] : null,
        isDriver: s.isDriver,
        updatedAt: new Date(),
      }).where(eq(employees.id, existingEmp.id));
    } else {
      const [created] = await db.insert(employees).values({
        tenantId: TENANT_ID as any,
        employeeNumber: s.empNo,
        title: s.title,
        firstName: s.firstName,
        lastName: s.lastName,
        jobTitle: s.jobTitle,
        departmentId: s.dept ? deptMap[s.dept] : undefined,
        officeId: s.office ? officeMap[s.office] : undefined,
        email: empEmail,
        phone: '+264 81 000 0000',
        employmentStatus: 'active',
        isDriver: s.isDriver,
      }).returning();
      employeeIdMap[s.empNo] = created.id;
    }
  }

  // Materialise actual department-office relationships without changing either record.
  for (const s of staffData) {
    const departmentId = s.dept ? deptMap[s.dept] : undefined;
    const officeId = s.office ? officeMap[s.office] : undefined;
    if (departmentId && officeId) {
      await db.insert(departmentOffices).values({ tenantId: TENANT_ID as any, departmentId, officeId }).onConflictDoNothing();
    }
  }

  // -------------------------------------------------------------------------
  // 8a. Kavango East employment-status correction (tenant-scoped, safe)
  // -------------------------------------------------------------------------
  // Imported rows can carry case variants (ACTIVE / Active / active) or legacy
  // values. Normalise only statuses that semantically mean ACTIVE to the
  // canonical value — archived and suspended staff are never activated. No
  // login accounts are created, availability and driver authorisation are left
  // untouched, and one audit entry records the whole batch.
  console.log('Normalising Kavango East employment statuses...');
  const kavangoEmployees = await db
    .select({
      id: employees.id,
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employmentStatus: employees.employmentStatus,
    })
    .from(employees)
    .where(eq(employees.tenantId, TENANT_ID as any));
  let statusesCorrected = 0;
  const correctedRows: Array<{ employeeNumber: string; from: string; to: string }> = [];
  for (const employeeRecord of kavangoEmployees) {
    const canonical = normaliseEmployeeStatus(employeeRecord.employmentStatus);
    if (canonical !== 'active' || canonical === employeeRecord.employmentStatus) continue;
    await db.update(employees)
      .set({ employmentStatus: 'active', updatedAt: new Date() })
      .where(eq(employees.id, employeeRecord.id));
    statusesCorrected++;
    correctedRows.push({
      employeeNumber: employeeRecord.employeeNumber,
      from: employeeRecord.employmentStatus,
      to: 'active',
    });
  }
  if (statusesCorrected > 0) {
    await recordAuditEvent({
      tenantId: TENANT_ID as any,
      actorUserId: 'seed-system',
      action: 'employee.status-normalised-batch',
      entityType: 'employee',
      after: { corrected: statusesCorrected, rows: correctedRows },
      summary: `Normalised ${statusesCorrected} Kavango East employment status(es) to the canonical ACTIVE value`,
      reason: 'Safe tenant-scoped correction of imported staff statuses; accounts, availability and driver authorisation unchanged',
    });
  }

  // -------------------------------------------------------------------------
  // 8b. Driver profiles & licences (for employees marked isDriver)
  // -------------------------------------------------------------------------
  console.log('Creating driver profiles and licences...');
  const driverEmployees = staffData.filter((s) => s.isDriver);
  for (const de of driverEmployees) {
    const empId = employeeIdMap[de.empNo];
    if (!empId) continue;

    // Check if driver profile already exists
    const [existingProfile] = await db
      .select({ id: driverProfiles.id })
      .from(driverProfiles)
      .where(eq(driverProfiles.employeeId, empId))
      .limit(1);

    let profileId: string;
    if (existingProfile) {
      profileId = existingProfile.id;
      await db.update(driverProfiles).set({ driverStatus: 'authorised', availabilityStatus: 'available', lastVerifiedAt: new Date(), notes: 'Synchronised by development seed', updatedAt: new Date() }).where(eq(driverProfiles.id, profileId));
    } else {
      const [profile] = await db.insert(driverProfiles).values({
        employeeId: empId,
        driverStatus: 'authorised',
        notes: 'Auto-created from seed',
      }).returning();
      profileId = profile.id;

    }
    const [existingLicence] = await db.select({ id: driverLicences.id }).from(driverLicences)
      .where(eq(driverLicences.driverProfileId, profileId)).limit(1);
    if (existingLicence) {
      await db.update(driverLicences).set({ licenceNumber: `LIC-${de.empNo}`, licenceClass: 'B', issueDate: '2023-01-01', expiryDate: '2028-12-31', isVerified: true, verificationStatus: 'verified', updatedAt: new Date() }).where(eq(driverLicences.id, existingLicence.id));
    } else {
      await db.insert(driverLicences).values({
        driverProfileId: profileId,
        licenceNumber: `LIC-${de.empNo}`,
        licenceClass: 'B',
        issueDate: new Date('2023-01-01').toISOString().split('T')[0],
        expiryDate: new Date('2028-12-31').toISOString().split('T')[0],
        isVerified: true,
        verificationStatus: 'verified',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9. Vehicle categories (idempotent)
  // -------------------------------------------------------------------------
  console.log('Creating vehicle categories...');
  const catDataList = [
    { tenantId: TENANT_ID as any, name: 'Sedan', code: 'SEDAN', description: 'Standard 4-door passenger vehicle suitable for tarred roads', passengerCapacity: 5, suitableTerrain: 'tar', fuelType: 'petrol' },
    { tenantId: TENANT_ID as any, name: 'Bakkie (Double Cab)', code: 'BAKKIE_DC', description: 'Pickup truck with double cab, suitable for gravel roads and field work', passengerCapacity: 5, suitableTerrain: 'gravel', fuelType: 'diesel' },
    { tenantId: TENANT_ID as any, name: 'Bakkie (Single Cab)', code: 'BAKKIE_SC', description: 'Pickup truck with single cab, for cargo and field work', passengerCapacity: 3, suitableTerrain: 'gravel', fuelType: 'diesel' },
  ];

  for (const cd of catDataList) {
    const [existingCat] = await db
      .select({ id: vehicleCategories.id })
      .from(vehicleCategories)
      .where(and(eq(vehicleCategories.tenantId, TENANT_ID as any), eq(vehicleCategories.code, cd.code)))
      .limit(1);
    if (!existingCat) {
      await db.insert(vehicleCategories).values(cd as any);
    }
  }

  // -------------------------------------------------------------------------
  // 10. Vehicles (idempotent by licenceNumber)
  // -------------------------------------------------------------------------
  console.log('Creating vehicles...');
  const [sedanCat] = await db.select().from(vehicleCategories).where(and(eq(vehicleCategories.tenantId, TENANT_ID as any), eq(vehicleCategories.code, 'SEDAN'))).limit(1);
  const [bakkieDCCat] = await db.select().from(vehicleCategories).where(and(eq(vehicleCategories.tenantId, TENANT_ID as any), eq(vehicleCategories.code, 'BAKKIE_DC'))).limit(1);

  const vehicleList = [
    { tenantId: TENANT_ID as any, categoryId: sedanCat?.id, officeId: headOfficeId, licenceNumber: 'GRN-001-2024', vehicleRegisterNumber: 'N 12345 KER', make: 'Toyota', model: 'Corolla', manufactureYear: 2023, colour: 'White', fuelType: 'petrol', transmission: 'manual', currentOdometer: 45230, status: 'available' },
    { tenantId: TENANT_ID as any, categoryId: sedanCat?.id, officeId: headOfficeId, licenceNumber: 'GRN-002-2024', vehicleRegisterNumber: 'N 12346 KER', make: 'Nissan', model: 'Sentra', manufactureYear: 2023, colour: 'Silver', fuelType: 'petrol', transmission: 'manual', currentOdometer: 38900, status: 'available' },
    { tenantId: TENANT_ID as any, categoryId: bakkieDCCat?.id, officeId: headOfficeId, licenceNumber: 'GRN-003-2024', vehicleRegisterNumber: 'N 23456 KER', make: 'Toyota', model: 'Hilux Double Cab', manufactureYear: 2024, colour: 'White', fuelType: 'diesel', transmission: 'manual', currentOdometer: 18200, status: 'available' },
    { tenantId: TENANT_ID as any, categoryId: bakkieDCCat?.id, officeId: headOfficeId, licenceNumber: 'GRN-004-2024', vehicleRegisterNumber: 'N 23457 KER', make: 'Ford', model: 'Ranger Double Cab', manufactureYear: 2024, colour: 'Blue', fuelType: 'diesel', transmission: 'automatic', currentOdometer: 25600, status: 'maintenance' },
    { tenantId: TENANT_ID as any, categoryId: bakkieDCCat?.id, officeId: officeMap['Rundu Urban Constituency Office'] || headOfficeId, licenceNumber: 'GRN-005-2024', vehicleRegisterNumber: 'N 34567 KER', make: 'Toyota', model: 'Hilux Double Cab', manufactureYear: 2023, colour: 'White', fuelType: 'diesel', transmission: 'manual', currentOdometer: 32100, status: 'available' },
  ];

  for (const v of vehicleList) {
    const [existing] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, TENANT_ID as any), eq(vehicles.licenceNumber, v.licenceNumber)))
      .limit(1);
    if (!existing) {
      await db.insert(vehicles).values(v as any);
    }
  }

  // -------------------------------------------------------------------------
  // 11. Workflow definitions (idempotent)
  // -------------------------------------------------------------------------
  console.log('Creating workflow definitions...');

  // Upsert regional workflow
  const [existingRegionalDef] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.tenantId, TENANT_ID as any), eq(workflowDefinitions.name, 'Regional Trip Workflow')))
    .limit(1);

  let regionalDef: { id: string };
  if (existingRegionalDef) {
    regionalDef = existingRegionalDef;
  } else {
    const [def] = await db.insert(workflowDefinitions)
      .values({ tenantId: TENANT_ID as any, tripScope: 'regional', name: 'Regional Trip Workflow', isActive: true })
      .returning();
    regionalDef = def;
  }

  // Upsert national workflow
  const [existingNationalDef] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.tenantId, TENANT_ID as any), eq(workflowDefinitions.name, 'National Trip Workflow')))
    .limit(1);

  let nationalDef: { id: string };
  if (existingNationalDef) {
    nationalDef = existingNationalDef;
  } else {
    const [def] = await db.insert(workflowDefinitions)
      .values({ tenantId: TENANT_ID as any, tripScope: 'national', name: 'National Trip Workflow', isActive: true })
      .returning();
    nationalDef = def;
  }

  // Upsert workflow steps (idempotent — delete + re-insert)
  await db.delete(workflowSteps).where(eq(workflowSteps.definitionId, regionalDef.id));
  await db.insert(workflowSteps).values([
    { definitionId: regionalDef.id, stepOrder: 1, actionType: 'supervisor_approve', requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR, label: 'Supervisor Approval', allowsEmergencyOverride: false },
    { definitionId: regionalDef.id, stepOrder: 2, actionType: 'transport_review', requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT, label: 'Transport Review', allowsEmergencyOverride: false },
    { definitionId: regionalDef.id, stepOrder: 3, actionType: 'release', requiredPermission: Permissions.VEHICLE_RELEASE_REGIONAL, label: 'Administrative Release', allowsEmergencyOverride: true },
    { definitionId: regionalDef.id, stepOrder: 4, actionType: 'authorise', requiredPermission: Permissions.TRIP_AUTHORIZE_REGIONAL, label: 'Final Authorisation', allowsEmergencyOverride: true, separationDutyRole: 'release' },
    { definitionId: regionalDef.id, stepOrder: 5, actionType: 'acknowledge', requiredPermission: Permissions.DRIVER_LOG_CREATE, label: 'Driver Acknowledgement', allowsEmergencyOverride: false },
  ]);

  // Versioned inspection templates are required; an empty checklist must never pass.
  for (const templateSeed of [
    { type: 'departure', name: 'Standard Departure Inspection', items: DEPARTURE_INSPECTION_ITEMS },
    { type: 'return', name: 'Standard Return Inspection', items: RETURN_INSPECTION_ITEMS },
  ]) {
    let [template] = await db.select({ id: inspectionTemplates.id }).from(inspectionTemplates)
      .where(and(eq(inspectionTemplates.tenantId, TENANT_ID as any), eq(inspectionTemplates.type, templateSeed.type), eq(inspectionTemplates.isActive, true))).limit(1);
    if (!template) {
      [template] = await db.insert(inspectionTemplates).values({ tenantId: TENANT_ID as any, name: templateSeed.name, type: templateSeed.type, version: 1, isActive: true }).returning({ id: inspectionTemplates.id });
    }
    const existingItems = await db.select({ label: inspectionTemplateItems.label }).from(inspectionTemplateItems).where(eq(inspectionTemplateItems.templateId, template.id));
    const existingLabels = new Set(existingItems.map((item) => item.label));
    const missingItems = templateSeed.items.filter((item) => !existingLabels.has(item.label));
    if (missingItems.length) {
      await db.insert(inspectionTemplateItems).values(missingItems.map((item) => ({ ...item, templateId: template.id, sortOrder: templateSeed.items.findIndex((candidate) => candidate.label === item.label) + 1 })));
    }
  }

  await db.delete(workflowSteps).where(eq(workflowSteps.definitionId, nationalDef.id));
  await db.insert(workflowSteps).values([
    { definitionId: nationalDef.id, stepOrder: 1, actionType: 'supervisor_approve', requiredPermission: Permissions.REQUEST_APPROVE_SUPERVISOR, label: 'Supervisor Approval', allowsEmergencyOverride: false },
    { definitionId: nationalDef.id, stepOrder: 2, actionType: 'transport_review', requiredPermission: Permissions.REQUEST_REVIEW_TRANSPORT, label: 'Transport Review', allowsEmergencyOverride: false },
    { definitionId: nationalDef.id, stepOrder: 3, actionType: 'release', requiredPermission: Permissions.VEHICLE_RELEASE_NATIONAL, label: 'Director Release', allowsEmergencyOverride: true },
    { definitionId: nationalDef.id, stepOrder: 4, actionType: 'authorise', requiredPermission: Permissions.TRIP_AUTHORIZE_NATIONAL, label: 'CRO Authorisation', allowsEmergencyOverride: true, separationDutyRole: 'release' },
    { definitionId: nationalDef.id, stepOrder: 5, actionType: 'acknowledge', requiredPermission: Permissions.DRIVER_LOG_CREATE, label: 'Driver Acknowledgement', allowsEmergencyOverride: false },
  ]);

  // -------------------------------------------------------------------------
  // 12. Separate role-based login accounts linked to employees
  // -------------------------------------------------------------------------
  console.log('Creating role-based login accounts...');
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'changeme';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const loginAccounts = [
    { key: 'tenant-admin', email: adminEmail, name: 'Kandjimi Amupanda', empNo: 'KERC001', roleName: RoleDefinitions.TENANT_ADMIN.name },
    { key: 'platform-admin', email: 'platform.admin@grnfleet.test', name: 'Paulus Platform', empNo: 'KERC014', roleName: RoleDefinitions.PLATFORM_SUPER_ADMIN.name },
    { key: 'transport-admin', email: 'transport.admin@kavangoeast.test', name: 'Ndapewa Hamutenya', empNo: 'KERC011', roleName: RoleDefinitions.TRANSPORT_ADMIN.name },
    { key: 'requester', email: 'requester@kavangoeast.test', name: 'Maria Shikongo', empNo: 'KERC002', roleName: RoleDefinitions.REQUESTER.name },
    { key: 'supervisor', email: 'supervisor@kavangoeast.test', name: 'Petrus Ndara', empNo: 'KERC003', roleName: RoleDefinitions.SUPERVISOR.name },
    { key: 'release-officer', email: 'release.officer@kavangoeast.test', name: 'Erastus Hausiku', empNo: 'KERC004', roleName: RoleDefinitions.CONTROL_ADMIN_OFFICER.name },
    { key: 'regional-authoriser', email: 'regional.authoriser@kavangoeast.test', name: 'Loide Kandjiri', empNo: 'KERC005', roleName: RoleDefinitions.DEPUTY_DIRECTOR.name },
    { key: 'national-release', email: 'national.release@kavangoeast.test', name: 'Tomas Sikongo', empNo: 'KERC006', roleName: RoleDefinitions.DIRECTOR.name },
    { key: 'national-authoriser', email: 'national.authoriser@kavangoeast.test', name: 'Rafael Kasume', empNo: 'KERC007', roleName: RoleDefinitions.CHIEF_REGIONAL_OFFICER.name },
    { key: 'driver', email: 'driver@kavangoeast.test', name: 'Michael Mwala', empNo: 'KERC008', roleName: RoleDefinitions.DRIVER.name },
    { key: 'inspector', email: 'inspector@kavangoeast.test', name: 'Tangeni Ndeitunga', empNo: 'KERC012', roleName: RoleDefinitions.INSPECTOR.name },
    { key: 'maintenance', email: 'maintenance@kavangoeast.test', name: 'Hilma Nakashole', empNo: 'KERC013', roleName: RoleDefinitions.MAINTENANCE_OFFICER.name },
    { key: 'auditor', email: 'auditor@kavangoeast.test', name: 'Johannes Shivute', empNo: 'KERC010', roleName: RoleDefinitions.TENANT_AUDITOR.name },
  ];
  const loginUserIds: Record<string, string> = {};

  for (const login of loginAccounts) {
    const [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, login.email)).limit(1);
    const userId = existingUser?.id || `user-seed-${login.key}`;
    loginUserIds[login.key] = userId;
    if (!existingUser) {
      await db.insert(user).values({ id: userId, email: login.email, username: login.key, emailVerified: true, name: login.name, createdAt: new Date(), updatedAt: new Date() });
    } else {
      await db.update(user).set({ name: login.name, username: login.key, emailVerified: true, updatedAt: new Date() }).where(eq(user.id, userId));
    }

    const [existingProfile] = await db.select({ id: userProfiles.id }).from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    if (!existingProfile) {
      await db.insert(userProfiles).values({ id: userId, userId, displayName: login.name, requiresPasswordChange: false, status: 'active' });
    }

    const [existingAccount] = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, 'email'))).limit(1);
    if (existingAccount) {
      await db.update(account).set({ password: passwordHash, accountId: login.email, updatedAt: new Date() }).where(eq(account.id, existingAccount.id));
    } else {
      await db.insert(account).values({ id: `account-seed-${login.key}`, accountId: login.email, providerId: 'email', userId, password: passwordHash, createdAt: new Date(), updatedAt: new Date() });
    }

    let [membership] = await db.select({ id: tenantMemberships.id }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, TENANT_ID as any), eq(tenantMemberships.userId, userId))).limit(1);
    if (!membership) {
      [membership] = await db.insert(tenantMemberships).values({ tenantId: TENANT_ID as any, userId, status: 'active' }).returning({ id: tenantMemberships.id });
    } else {
      await db.update(tenantMemberships).set({ status: 'active' }).where(eq(tenantMemberships.id, membership.id));
    }

    const employeeId = employeeIdMap[login.empNo];
    if (!employeeId) throw new Error(`Missing seed employee ${login.empNo}`);
    await db.update(employees).set({ userId, email: login.email, updatedAt: new Date() }).where(eq(employees.id, employeeId));

    const roleRecord = roleRecords.find((role) => role.name === login.roleName);
    if (!roleRecord) throw new Error(`Missing seed role ${login.roleName}`);
    await db.delete(roleAssignments).where(eq(roleAssignments.tenantMembershipId, membership.id));
    await db.insert(roleAssignments).values({ tenantMembershipId: membership.id, roleId: roleRecord.id, officeId: officeMap[staffData.find((staff) => staff.empNo === login.empNo)!.office] });
  }

  for (const assignment of [
    { definitionId: regionalDef.id, stepOrder: 1, userKey: 'supervisor' },
    { definitionId: regionalDef.id, stepOrder: 2, userKey: 'transport-admin' },
    { definitionId: regionalDef.id, stepOrder: 3, userKey: 'release-officer' },
    { definitionId: regionalDef.id, stepOrder: 4, userKey: 'regional-authoriser' },
    { definitionId: regionalDef.id, stepOrder: 5, userKey: 'driver' },
    { definitionId: nationalDef.id, stepOrder: 1, userKey: 'supervisor' },
    { definitionId: nationalDef.id, stepOrder: 2, userKey: 'transport-admin' },
    { definitionId: nationalDef.id, stepOrder: 3, userKey: 'national-release' },
    { definitionId: nationalDef.id, stepOrder: 4, userKey: 'national-authoriser' },
    { definitionId: nationalDef.id, stepOrder: 5, userKey: 'driver' },
  ]) {
    await db.update(workflowSteps).set({ assignedUserId: loginUserIds[assignment.userKey] })
      .where(and(eq(workflowSteps.definitionId, assignment.definitionId), eq(workflowSteps.stepOrder, assignment.stepOrder)));
  }

  // A second tenant with a known vehicle provides a stable cross-tenant isolation fixture.
  // status + lifecycleStatus both ARCHIVED so its (empty) user set can never
  // authenticate — matching the state a production archive would leave behind.
  await db.insert(tenants).values({ id: ISOLATION_TENANT_ID as any, name: 'Zambezi Regional Council — Isolation Fixture', code: 'ZRC', slug: 'zambezi-isolation', type: 'regional_council', status: 'ARCHIVED', planCode: 'INTERNAL_DEFAULT', subscriptionStatus: 'NOT_CONFIGURED', lifecycleStatus: 'ARCHIVED', timezone: 'Africa/Windhoek', locale: 'en-NA' }).onConflictDoNothing();
  let [isolationOffice] = await db.select({ id: offices.id }).from(offices).where(and(eq(offices.tenantId, ISOLATION_TENANT_ID as any), eq(offices.code, 'ZHO'))).limit(1);
  if (!isolationOffice) [isolationOffice] = await db.insert(offices).values({ tenantId: ISOLATION_TENANT_ID as any, name: 'Zambezi Head Office', type: 'head_office', code: 'ZHO' }).returning({ id: offices.id });
  let [isolationCategory] = await db.select({ id: vehicleCategories.id }).from(vehicleCategories).where(and(eq(vehicleCategories.tenantId, ISOLATION_TENANT_ID as any), eq(vehicleCategories.code, 'ISO-SEDAN'))).limit(1);
  if (!isolationCategory) [isolationCategory] = await db.insert(vehicleCategories).values({ tenantId: ISOLATION_TENANT_ID as any, name: 'Isolation Sedan', code: 'ISO-SEDAN', passengerCapacity: 5 }).returning({ id: vehicleCategories.id });
  const [isolationVehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.tenantId, ISOLATION_TENANT_ID as any), eq(vehicles.licenceNumber, 'ZRC-ISOLATION-001'))).limit(1);
  if (!isolationVehicle) await db.insert(vehicles).values({ tenantId: ISOLATION_TENANT_ID as any, categoryId: isolationCategory.id, officeId: isolationOffice.id, licenceNumber: 'ZRC-ISOLATION-001', vehicleRegisterNumber: 'N 99999 ZM', make: 'Isolation', model: 'Fixture', manufactureYear: 2025, fuelType: 'petrol', currentOdometer: 10, status: 'available' });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('✅ Seed complete!');
  console.log('   Tenant: Kavango East Regional Council');
  console.log(`   Employees: ${staffData.length} synchronised`);
  console.log('   Driver profiles + licences: 2 created');
  console.log(`   Login accounts: ${loginAccounts.length} role-based accounts`);
  console.log(`   Test password: ${adminPassword}`);
  console.log('   Username format: <role-key> (e.g. tenant-admin, driver, requester)');
  console.log('   Username also accepts email addresses as fallback.');
  console.log('   Vehicles: 5 (3 available, 1 in maintenance, 1 at constituency)');
  console.log(`   Roles: ${roleNames.length} system roles with permissions`);
  console.log('   Workflows: Regional and National');
  console.log('   Isolation fixture: second tenant with one vehicle');
}

seed()
  .catch((e: unknown) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
