/**
 * Development Data Reset — integrity checks
 *
 * Runs after a reset (and after a dry-run, for informational purposes) to
 * detect orphaned records, broken references, and duplicate identifiers.
 * Every check is read-only. A reset is only marked fully successful when the
 * critical checks pass.
 */
import { sql } from 'drizzle-orm';
import type { ResetDb } from './plan';

export interface IntegrityCheck {
  id: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  count: number;
  detail: string[];
  passed: boolean;
}

interface CheckSpec {
  id: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  query: string;
  /** Optional column(s) returned as detail rows (defaults to id). */
  detailColumn?: string;
}

function buildChecks(tenantId: string): CheckSpec[] {
  const t = tenantId;
  return [
    {
      id: 'role_assignments_missing_membership',
      label: 'Role assignments referencing missing tenant memberships',
      severity: 'critical',
      query: `SELECT ra.id FROM role_assignments ra LEFT JOIN tenant_memberships tm ON tm.id = ra.tenant_membership_id WHERE tm.id IS NULL AND ra.tenant_membership_id IN (SELECT id FROM tenant_memberships WHERE tenant_id = '${t}')`,
    },
    {
      id: 'employees_missing_office',
      label: 'Employees referencing missing offices',
      severity: 'warning',
      query: `SELECT e.id FROM employees e LEFT JOIN offices o ON o.id = e.office_id WHERE e.tenant_id = '${t}' AND e.office_id IS NOT NULL AND o.id IS NULL`,
    },
    {
      id: 'employees_missing_department',
      label: 'Employees referencing missing departments',
      severity: 'warning',
      query: `SELECT e.id FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.tenant_id = '${t}' AND e.department_id IS NOT NULL AND d.id IS NULL`,
    },
    {
      id: 'driver_profiles_missing_employee',
      label: 'Driver profiles referencing missing staff',
      severity: 'critical',
      query: `SELECT dp.id FROM driver_profiles dp LEFT JOIN employees e ON e.id = dp.employee_id WHERE e.id IS NULL AND dp.employee_id IN (SELECT id FROM employees WHERE tenant_id = '${t}')`,
    },
    {
      id: 'licences_missing_driver_profile',
      label: 'Licences referencing missing driver profiles',
      severity: 'critical',
      query: `SELECT dl.id FROM driver_licences dl LEFT JOIN driver_profiles dp ON dp.id = dl.driver_profile_id WHERE dp.id IS NULL AND dl.driver_profile_id IN (SELECT dp2.id FROM driver_profiles dp2 JOIN employees e ON e.id = dp2.employee_id WHERE e.tenant_id = '${t}')`,
    },
    {
      id: 'requests_missing_requester',
      label: 'Transport requests referencing missing requester staff',
      severity: 'critical',
      query: `SELECT tr.id FROM transport_requests tr LEFT JOIN employees e ON e.id = tr.requester_employee_id WHERE tr.tenant_id = '${t}' AND e.id IS NULL`,
    },
    {
      id: 'trips_missing_request',
      label: 'Trips referencing deleted requests',
      severity: 'critical',
      query: `SELECT tp.id FROM trips tp LEFT JOIN transport_requests tr ON tr.id = tp.request_id WHERE tp.tenant_id = '${t}' AND tr.id IS NULL`,
    },
    {
      id: 'allocations_missing_request',
      label: 'Allocations referencing deleted requests',
      severity: 'critical',
      query: `SELECT va.id FROM vehicle_allocations va LEFT JOIN transport_requests tr ON tr.id = va.request_id WHERE va.request_id IN (SELECT id FROM transport_requests WHERE tenant_id = '${t}') AND tr.id IS NULL`,
    },
    {
      id: 'share_links_missing_document',
      label: 'Share links referencing missing documents',
      severity: 'warning',
      query: `SELECT sl.id FROM share_links sl LEFT JOIN generated_documents gd ON gd.id = sl.document_id WHERE sl.tenant_id = '${t}' AND gd.id IS NULL`,
    },
    {
      id: 'notifications_missing_entity',
      label: 'Notifications referencing missing entities',
      severity: 'warning',
      // entity_id is a loose polymorphic reference, so verify against every
      // table the app can target with a notification.
      query: `SELECT n.id FROM notifications n WHERE n.tenant_id = '${t}' AND n.entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transport_requests tr WHERE tr.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM trips tp WHERE tp.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM vehicle_allocations va WHERE va.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM trip_authorities ta WHERE ta.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM fuel_transactions ft WHERE ft.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM generated_documents gd WHERE gd.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM maintenance_events me WHERE me.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM programmes p WHERE p.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM regions rg WHERE rg.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM driver_licences dl WHERE dl.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM employees em WHERE em.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM offices of WHERE of.id = n.entity_id) AND NOT EXISTS (SELECT 1 FROM departments dp WHERE dp.id = n.entity_id)`,
    },
    {
      id: 'duplicate_employee_numbers',
      label: 'Duplicate employee numbers',
      severity: 'warning',
      query: `SELECT e.employee_number FROM employees e WHERE e.tenant_id = '${t}' GROUP BY e.employee_number HAVING COUNT(*) > 1`,
      detailColumn: 'employee_number',
    },
    {
      id: 'duplicate_licence_numbers',
      label: 'Duplicate licence numbers',
      severity: 'warning',
      query: `SELECT dl.licence_number FROM driver_licences dl WHERE dl.driver_profile_id IN (SELECT dp.id FROM driver_profiles dp JOIN employees e ON e.id = dp.employee_id WHERE e.tenant_id = '${t}') GROUP BY dl.licence_number HAVING COUNT(*) > 1`,
      detailColumn: 'licence_number',
    },
    {
      id: 'duplicate_vehicle_registrations',
      label: 'Duplicate vehicle registration numbers',
      severity: 'warning',
      query: `SELECT v.licence_number FROM vehicles v WHERE v.tenant_id = '${t}' GROUP BY v.licence_number HAVING COUNT(*) > 1`,
      detailColumn: 'licence_number',
    },
  ];
}

/**
 * Run all integrity checks for a tenant. Returns per-check results.
 */
export async function runIntegrityChecks(
  db: ResetDb,
  tenantId: string,
): Promise<IntegrityCheck[]> {
  const results: IntegrityCheck[] = [];
  for (const spec of buildChecks(tenantId)) {
    try {
      const query = sql.raw(spec.query);
      const result = await db.execute(query);
      const rows = result.rows ?? [];
      const detail = rows
        .slice(0, 10)
        .map((row) => String(row[spec.detailColumn ?? 'id'] ?? ''));
      results.push({
        id: spec.id,
        label: spec.label,
        severity: spec.severity,
        count: rows.length,
        detail,
        passed: rows.length === 0,
      });
    } catch (error) {
      results.push({
        id: spec.id,
        label: spec.label,
        severity: spec.severity,
        count: -1,
        detail: [error instanceof Error ? error.message : String(error)],
        passed: false,
      });
    }
  }
  return results;
}

/**
 * True when no critical check failed.
 */
export function criticalChecksPassed(checks: IntegrityCheck[]): boolean {
  return checks
    .filter((check) => check.severity === 'critical')
    .every((check) => check.passed);
}
