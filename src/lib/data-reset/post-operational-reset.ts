import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

/**
 * Master records intentionally survive an operational reset, but some fields on
 * those records are runtime projections of deleted allocations/trips. Reconcile
 * only those operation-derived states after the governed reset transaction has
 * completed. Permanent/manual states (maintenance, out_of_service, leave,
 * suspended, etc.) are deliberately not changed.
 */
export const OPERATION_DERIVED_VEHICLE_STATUSES = [
  'provisional',
  'allocated',
  'issued',
  'in_use',
  'return_inspection',
] as const;

export const OPERATION_DERIVED_AVAILABILITY_STATUSES = ['assigned', 'on_trip'] as const;

function rowCount(result: { rows?: unknown[] }) {
  return Array.isArray(result.rows) ? result.rows.length : 0;
}

export async function reconcileTenantOperationalResetState(tenantId: string) {
  const db = getDb();

  // This is intentionally a tenant-wide postcondition. The reset plan normally
  // deletes these rows already, but a second tenant-scoped pass prevents stale
  // Driver/role notifications with dead action URLs from surviving because of
  // an unexpected entity type or an older producer. Governed reset history is
  // preserved so the requester can still see reset approval/outcome messages.
  const notificationResult = await db.execute(sql`
    DELETE FROM notifications
    WHERE tenant_id = ${tenantId}
      AND entity_type IS DISTINCT FROM 'reset_request'
    RETURNING id
  `);

  const vehicleResult = await db.execute(sql`
    UPDATE vehicles
    SET status = 'available', updated_at = NOW(), version = version + 1
    WHERE tenant_id = ${tenantId}
      AND status IN ('provisional', 'allocated', 'issued', 'in_use', 'return_inspection')
    RETURNING id
  `);

  const driverResult = await db.execute(sql`
    UPDATE driver_profiles AS dp
    SET availability_status = 'available', unavailable_until = NULL, updated_at = NOW()
    FROM employees AS e
    WHERE e.id = dp.employee_id
      AND e.tenant_id = ${tenantId}
      AND dp.availability_status IN ('assigned', 'on_trip')
    RETURNING dp.id
  `);

  const employeeResult = await db.execute(sql`
    UPDATE employees
    SET availability_status = 'available', updated_at = NOW()
    WHERE tenant_id = ${tenantId}
      AND availability_status IN ('assigned', 'on_trip')
    RETURNING id
  `);

  return {
    notificationsRemoved: rowCount(notificationResult),
    vehiclesReleased: rowCount(vehicleResult),
    driversReleased: rowCount(driverResult),
    employeesReleased: rowCount(employeeResult),
  };
}
