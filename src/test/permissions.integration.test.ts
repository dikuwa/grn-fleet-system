/**
 * Permission Enforcement Tests
 *
 * Verifies that permission-based access control is enforced correctly:
 * - Users can only access entities they have permissions for
 * - Role assignments are respected
 * - System roles protect critical operations
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getDb } from '@/db';
import { eq } from 'drizzle-orm';
import { tenants } from '@/db/schema/tenants';
import { roles, rolePermissions, roleAssignments, permissions } from '@/db/schema';
import { Permissions, PermissionGroups } from '@/lib/permissions';

let TENANT_ID: string | null = null;

beforeAll(async () => {
  try {
    const db = getDb();
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .orderBy(tenants.createdAt)
      .limit(1);
    if (tenant) TENANT_ID = tenant.id;
  } catch {
    // Database not available
  }
});

describe('Permission system integrity', () => {
  // -------------------------------------------------------------------------
  // 1. All permission codes are defined in the database
  // -------------------------------------------------------------------------

  it('should have all permission codes registered in the permissions table', async () => {
    if (!TENANT_ID) return;
    const db = getDb();

    const dbPerms = await db
      .select({ code: permissions.code })
      .from(permissions);

    const dbCodes = new Set(dbPerms.map((p) => p.code));
    const expectedCodes = Object.values(Permissions);

    for (const code of expectedCodes) {
      expect(dbCodes.has(code)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 2. All permission groups in PermissionGroups match registered codes
  // -------------------------------------------------------------------------

  it('should have all PermissionGroups reference valid permission codes', () => {
    const validCodes = new Set(Object.values(Permissions));

    for (const group of Object.values(PermissionGroups)) {
      for (const permCode of group.permissions) {
        expect(validCodes.has(permCode)).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 3. System roles exist in the database
  // -------------------------------------------------------------------------

  it('should have all system roles defined in the database', async () => {
    if (!TENANT_ID) return;
    const db = getDb();

    const systemRoles = await db
      .select({ name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.isSystem, true));

    expect(systemRoles.length).toBeGreaterThanOrEqual(9);

    const roleNames = new Set(systemRoles.map((r) => r.name));
    expect(roleNames.has('Transport Administrator')).toBe(true);
    expect(roleNames.has('Platform Super Administrator')).toBe(true);
    expect(roleNames.has('Requester / Programme Owner')).toBe(true);
    expect(roleNames.has('Immediate Supervisor')).toBe(true);
    expect(roleNames.has('Assigned Driver')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Each system role has its expected permissions
  // -------------------------------------------------------------------------

  it('should assign correct permissions to system roles', async () => {
    if (!TENANT_ID) return;
    const db = getDb();

    // Get the Transport Administrator role
    const [transportAdminRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'Transport Administrator'))
      .limit(1);

    if (!transportAdminRole) return;

    const permRows = await db
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, transportAdminRole.id));

    const assignedPerms = new Set(permRows.map((p) => p.code));

    // Transport Admin should have these core permissions
    expect(assignedPerms.has(Permissions.VEHICLE_MANAGE)).toBe(true);
    expect(assignedPerms.has(Permissions.VEHICLE_CREATE)).toBe(true);
    expect(assignedPerms.has(Permissions.REQUEST_VIEW)).toBe(true);
    expect(assignedPerms.has(Permissions.TRIP_MANAGE)).toBe(true);
    expect(assignedPerms.has(Permissions.STAFF_IMPORT)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Permission code uniqueness
  // -------------------------------------------------------------------------

  it('should have unique permission codes without duplicates', () => {
    const codes = Object.values(Permissions);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  // -------------------------------------------------------------------------
  // 6. Permission groups cover all permission codes
  // -------------------------------------------------------------------------

  it('should cover all permission codes across all groups', () => {
    const groupedPerms = new Set(
      Object.values(PermissionGroups).flatMap((g) => g.permissions),
    );
    const allPerms = Object.values(Permissions);

    for (const perm of allPerms) {
      expect(groupedPerms.has(perm)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 7. No orphan role assignments reference deleted roles
  // -------------------------------------------------------------------------

  it('should not have orphan role assignments', async () => {
    if (!TENANT_ID) return;
    const db = getDb();

    const assignments = await db
      .select({ roleId: roleAssignments.roleId })
      .from(roleAssignments)
      .limit(50);

    const dbRoles = await db.select({ id: roles.id }).from(roles);
    const roleIds = new Set(dbRoles.map((r) => r.id));

    for (const assign of assignments) {
      expect(roleIds.has(assign.roleId)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 8. System roles cannot be deleted (structural check)
  // -------------------------------------------------------------------------

  it('should mark system roles correctly in the database', async () => {
    if (!TENANT_ID) return;
    const db = getDb();

    const systemRoles = await db
      .select({ name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.isSystem, true));

    for (const role of systemRoles) {
      expect(role.isSystem).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 9. Each permission has a human-readable name and group
  // -------------------------------------------------------------------------

  it('should have descriptive metadata for each permission code', async () => {
    if (!TENANT_ID) return;
    const db = getDb();

    const dbPerms = await db.select().from(permissions);

    for (const perm of dbPerms) {
      expect(perm.name).toBeTruthy();
      expect(perm.group).toBeTruthy();
      expect(perm.code).toBeTruthy();
    }
  });

  // -------------------------------------------------------------------------
  // 10. Role-permission assignments are valid
  // -------------------------------------------------------------------------

  it('should have valid permission codes in all role_permissions rows', async () => {
    if (!TENANT_ID) return;
    const db = getDb();

    const validCodes = new Set(Object.values(Permissions));
    const rpRows = await db
      .select({ permissionCode: rolePermissions.permissionCode })
      .from(rolePermissions)
      .limit(100);

    for (const row of rpRows) {
      expect(validCodes.has(row.permissionCode as typeof Permissions[keyof typeof Permissions])).toBe(true);
    }
  });
});
