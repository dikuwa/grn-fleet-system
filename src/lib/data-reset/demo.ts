/**
 * Development Data Reset — demo account & demo vehicle modes
 *
 * Mode B (demo-accounts): lists disposable demo users/staff for review but
 * never deletes automatically. A user is only *proposed* for deletion when
 * it is conclusively a seed/demo account with no roles, no staff link, no
 * tenant responsibility, and no audit history requirement.
 *
 * Mode C (demo-vehicles): deletes only vehicles whose licence numbers carry
 * the explicit E2E demo prefix, and refuses to run while operational records
 * still reference them (run the operational reset first).
 */
import { sql } from 'drizzle-orm';
import { DEMO_VEHICLE_LICENCE_PREFIXES, SEED_USER_ID_PREFIX, quoteTable, uuidArrayLiteral } from './config';
import type { ResetDb } from './plan';

// ---------------------------------------------------------------------------
// Demo accounts
// ---------------------------------------------------------------------------

export interface DemoAccount {
  userId: string;
  email: string;
  name: string | null;
  username: string | null;
  hasRole: boolean;
  staffLinked: boolean;
  memberOfTenant: boolean;
  createdBySeed: boolean;
  proposed: boolean;
  reasons: string[];
}

export async function listDemoAccounts(
  db: ResetDb,
  tenantId: string,
): Promise<{ proposed: DemoAccount[]; preserved: DemoAccount[] }> {
  const result = await db.execute(sql`SELECT
      u.id,
      u.email,
      u.name,
      u.username,
      EXISTS (
        SELECT 1 FROM tenant_memberships tm
        WHERE tm.user_id = u.id AND tm.tenant_id = ${tenantId}
      ) AS member_of_tenant,
      EXISTS (
        SELECT 1 FROM role_assignments ra
        JOIN tenant_memberships tm ON tm.id = ra.tenant_membership_id
        WHERE tm.user_id = u.id AND tm.tenant_id = ${tenantId}
      ) AS has_role,
      EXISTS (
        SELECT 1 FROM employees e WHERE e.user_id = u.id
      ) AS staff_linked
    FROM "user" u
    WHERE u.id LIKE ${SEED_USER_ID_PREFIX + '%'}
       OR u.email LIKE '%.test'
       OR u.email IN ('admin@kavangoeast.gov.na')
    ORDER BY u.email`);

  const accounts: DemoAccount[] = result.rows.map((row) => {
    const userId = String(row.id ?? '');
    const email = String(row.email ?? '');
    const hasRole = row.has_role === true || row.has_role === 't';
    const staffLinked = row.staff_linked === true || row.staff_linked === 't';
    const memberOfTenant = row.member_of_tenant === true || row.member_of_tenant === 't';
    const createdBySeed = userId.startsWith(SEED_USER_ID_PREFIX) || email.endsWith('.test');
    const reasons: string[] = [];
    if (!createdBySeed) reasons.push('not conclusively a seed account');
    if (hasRole) reasons.push('has one or more role assignments');
    if (staffLinked) reasons.push('linked to a staff record');
    if (memberOfTenant) reasons.push('belongs to a tenant');
    const proposed = createdBySeed && !hasRole && !staffLinked && !memberOfTenant;
    return {
      userId,
      email,
      name: row.name ? String(row.name) : null,
      username: row.username ? String(row.username) : null,
      hasRole,
      staffLinked,
      memberOfTenant,
      createdBySeed,
      proposed,
      reasons,
    };
  });

  return {
    proposed: accounts.filter((a) => a.proposed),
    preserved: accounts.filter((a) => !a.proposed),
  };
}

export interface DemoAccountDeleteResult {
  deleted: number;
  blocked: Array<{ userId: string; reason: string }>;
}

/**
 * Delete explicitly approved demo accounts (Mode B execute).
 *
 * Only accounts in the *proposed* set (conclusively seed accounts with no
 * roles, no staff link and no tenant membership) may be deleted, and only
 * when their ids are explicitly passed in `approvedUserIds`. Anything else is
 * reported as blocked, never deleted. The caller is responsible for the
 * environment guard, confirmation phrase, backup and audit record.
 */
export async function deleteDemoAccounts(
  db: ResetDb,
  tenantId: string,
  approvedUserIds: string[],
): Promise<DemoAccountDeleteResult> {
  const { proposed } = await listDemoAccounts(db, tenantId);
  const proposedById = new Map(proposed.map((account) => [account.userId, account]));
  const requested = new Set(approvedUserIds);
  const blocked: Array<{ userId: string; reason: string }> = [];

  const idsToDelete = proposed
    .filter((account) => requested.has(account.userId))
    .map((account) => account.userId);

  // Any requested id that is NOT conclusively disposable is blocked.
  for (const id of approvedUserIds) {
    if (!proposedById.has(id)) {
      blocked.push({
        userId: id,
        reason:
          'Not a conclusively disposable demo account (has roles, a staff link, or tenant membership). Refusing to delete.',
      });
    }
  }

  let deleted = 0;
  for (const userId of idsToDelete) {
    try {
      // Child rows are loose text refs (no FK cascade) — remove them first,
      // then the user. session/account cascade automatically.
      await db.execute(sql`DELETE FROM ${sql.raw(quoteTable('user_profiles'))} WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM ${sql.raw(quoteTable('user'))} WHERE id = ${userId}`);
      deleted += 1;
    } catch (error) {
      blocked.push({
        userId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { deleted, blocked };
}

// ---------------------------------------------------------------------------
// Demo vehicles
// ---------------------------------------------------------------------------

export interface DemoVehicle {
  id: string;
  licenceNumber: string;
  make: string | null;
  model: string | null;
  status: string | null;
  hasOperationalRecords: boolean;
}

export async function listDemoVehicles(db: ResetDb, tenantId: string): Promise<DemoVehicle[]> {
  const prefixCondition = DEMO_VEHICLE_LICENCE_PREFIXES.map(
    (prefix) => sql`v.licence_number LIKE ${prefix + '%'}`,
  );
  const query = sql`SELECT
      v.id,
      v.licence_number,
      v.make,
      v.model,
      v.status,
      EXISTS (
        SELECT 1 FROM trips t WHERE t.vehicle_id = v.id
      ) OR EXISTS (
        SELECT 1 FROM vehicle_allocations va WHERE va.vehicle_id = v.id
      ) OR EXISTS (
        SELECT 1 FROM vehicle_odometer_events voe WHERE voe.vehicle_id = v.id
      ) OR EXISTS (
        SELECT 1 FROM vehicle_defects vd WHERE vd.vehicle_id = v.id
      ) AS has_operational_records
    FROM vehicles v
    WHERE v.tenant_id = ${tenantId} AND (${sql.join(prefixCondition, sql` OR `)})`;

  const result = await db.execute(query);
  return (result.rows ?? []).map((row) => ({
    id: String(row.id ?? ''),
    licenceNumber: String(row.licence_number ?? ''),
    make: row.make ? String(row.make) : null,
    model: row.model ? String(row.model) : null,
    status: row.status ? String(row.status) : null,
    hasOperationalRecords: row.has_operational_records === true || row.has_operational_records === 't',
  }));
}

/**
 * Delete demo vehicles by id. Refuses when operational records still
 * reference them — run the operational reset first.
 */
export async function deleteDemoVehicles(
  db: ResetDb,
  tenantId: string,
  vehicleIds: string[],
): Promise<{ deleted: number; blocked: string[] }> {
  const vehicles = await listDemoVehicles(db, tenantId);
  const requested = new Set(vehicleIds);
  const blocked: string[] = [];

  for (const vehicle of vehicles) {
    if (!requested.has(vehicle.id)) continue;
    if (vehicle.hasOperationalRecords) {
      blocked.push(
        `${vehicle.licenceNumber} still has operational records (trips/allocations/events). Run the operational reset first.`,
      );
    }
  }

  if (blocked.length > 0) {
    return { deleted: 0, blocked };
  }

  const idsToDelete = vehicles
    .filter((v) => requested.has(v.id) && !v.hasOperationalRecords)
    .map((v) => v.id);
  if (idsToDelete.length === 0) return { deleted: 0, blocked };

  // Vehicle children that are safe to remove with the vehicle.
  const childTables: Array<[string, string]> = [
    ['vehicle_documents', 'vehicle_id'],
    ['vehicle_odometer_events', 'vehicle_id'],
    ['vehicle_status_events', 'vehicle_id'],
    ['vehicle_defects', 'vehicle_id'],
    ['maintenance_events', 'vehicle_id'],
  ];
  for (const [table, column] of childTables) {
    await db.execute(
      sql`DELETE FROM ${sql.raw(quoteTable(table))} WHERE ${sql.raw(column)} = ANY(${sql.raw(uuidArrayLiteral(idsToDelete))})`,
    );
  }
  await db.execute(sql`DELETE FROM ${sql.raw(quoteTable('vehicles'))} WHERE id = ANY(${sql.raw(uuidArrayLiteral(idsToDelete))})`);

  return { deleted: idsToDelete.length, blocked };
}
