/**
 * Development Data Reset — plan builder
 *
 * Builds a complete, tenant-scoped plan for a reset *without deleting
 * anything*. It:
 *
 *   1. resolves the selected tenant;
 *   2. collects the tenant's operational entity id sets (requests, trips,
 *      allocations, authorities, inspections, fuel, workflow instances,
 *      generated documents, notifications);
 *   3. computes per-table deletion counts in foreign-key-safe order;
 *   4. collects storage keys attached to the records that would be removed;
 *   5. counts "requires review" records and preserved reference data.
 *
 * The plan is the single source of truth for both the dry-run report and the
 * executable reset, so a dry-run and an execute always agree.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  OPERATIONAL_DELETE_STEPS,
  PRESERVED_TABLES,
  REVIEW_ONLY_TABLES,
  quoteTable,
  textArrayLiteral,
  uuidArrayLiteral,
  type DeleteStep,
  type ResetMode,
} from './config';

/** Minimal db surface used by the reset tooling (satisfied by both drivers). */
export interface ResetDb {
  execute(query: unknown): Promise<{ rows: Array<Record<string, unknown>> }>;
  transaction?: <T>(callback: (tx: unknown) => Promise<T>) => Promise<T>;
}

export interface EntityIdSets {
  requestIds: string[];
  tripIds: string[];
  allocationIds: string[];
  authorityIds: string[];
  inspectionIds: string[];
  fuelTransactionIds: string[];
  workflowInstanceIds: string[];
  generatedDocumentIds: string[];
  notificationIds: string[];
  /** Union of every id set above — used for notification/document scoping. */
  removedEntityIds: string[];
}

export interface StepPlan {
  table: string;
  label: string;
  before: number;
  fileKeyColumns?: string[];
  /** Delete scope from the config registry (source of truth for scoping). */
  scope: DeleteStep['scope'];
}

export interface ReviewItem {
  table: string;
  label: string;
  reason: string;
  count: number;
}

export interface ResetPlan {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  mode: ResetMode;
  dryRun: boolean;
  database: string;
  timestamp: string;
  ids: EntityIdSets;
  steps: StepPlan[];
  /** Storage keys attached to records scheduled for removal. */
  fileKeys: string[];
  review: ReviewItem[];
  preserved: Array<{ table: string; label: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Query helpers (driver-agnostic via db.execute + drizzle sql templates)
// ---------------------------------------------------------------------------

async function queryRows(
  db: ResetDb,
  query: SQL,
): Promise<Array<Record<string, unknown>>> {
  const result = await db.execute(query);
  return result.rows ?? [];
}

async function queryCount(db: ResetDb, query: SQL): Promise<number> {
  const rows = await queryRows(db, query);
  const value = rows[0]?.count;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function collectIds(db: ResetDb, query: SQL): Promise<string[]> {
  const rows = await queryRows(db, query);
  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

// ---------------------------------------------------------------------------
// Scope → WHERE condition resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the WHERE clause (drizzle sql fragment) used to select/delete a
 * table's rows for the selected tenant. Returns null when there is nothing to
 * target (empty id set).
 */
export function resolveStepCondition(
  step: DeleteStep,
  ids: EntityIdSets,
  tenantId: string,
): SQL | null {
  const requestIds = ids.requestIds;
  const tripIds = ids.tripIds;
  const allocationIds = ids.allocationIds;
  const authorityIds = ids.authorityIds;
  const inspectionIds = ids.inspectionIds;
  const fuelIds = ids.fuelTransactionIds;
  const workflowIds = ids.workflowInstanceIds;
  const documentIds = ids.generatedDocumentIds;
  const notificationIds = ids.notificationIds;
  const removedEntityIds = ids.removedEntityIds;

  switch (step.table) {
    // -- entity-scoped generated documents (tenant + entity_id in removed set)
    case 'generated_documents': {
      if (removedEntityIds.length === 0) return null;
      return sql`tenant_id = ${tenantId} AND entity_id = ANY(${sql.raw(uuidArrayLiteral(removedEntityIds))})`;
    }
    // -- inspections scoped by tenant + trip
    case 'vehicle_inspections': {
      if (tripIds.length === 0) return null;
      return sql`tenant_id = ${tenantId} AND trip_id = ANY(${sql.raw(uuidArrayLiteral(tripIds))})`;
    }
    // -- odometer events produced by removed inspections / fuel entries / trips
    case 'vehicle_odometer_events': {
      const parts: SQL[] = [];
      if (inspectionIds.length > 0) {
        parts.push(
          sql`(source_entity_type = 'inspection' AND source_entity_id = ANY(${sql.raw(uuidArrayLiteral(inspectionIds))}))`,
        );
      }
      if (fuelIds.length > 0) {
        parts.push(
          sql`(source_entity_type = 'fuel_transaction' AND source_entity_id = ANY(${sql.raw(uuidArrayLiteral(fuelIds))}))`,
        );
      }
      // Trip lifecycle events (trip_start / trip_return) carry the trip id in
      // source_entity_id. Without this branch they survive the reset and later
      // block Mode C demo-vehicle deletion.
      if (tripIds.length > 0) {
        parts.push(
          sql`(source_entity_type = 'trip' AND source_entity_id = ANY(${sql.raw(uuidArrayLiteral(tripIds))}))`,
        );
      }
      if (parts.length === 0) return null;
      return sql`(${sql.join(parts, sql` OR `)})`;
    }
    // -- status events raised by removed trips / allocations
    case 'vehicle_status_events': {
      const eventIds = [...tripIds, ...allocationIds];
      if (eventIds.length === 0) return null;
      // reference_entity_id is text, so the literal must be text[], not uuid[]
      return sql`reference_entity_type IN ('trip','allocation') AND reference_entity_id = ANY(${sql.raw(textArrayLiteral(eventIds))})`;
    }
    // -- defects raised on removed trips or inspections
    case 'vehicle_defects': {
      const parts: SQL[] = [];
      if (tripIds.length > 0) {
        parts.push(sql`trip_id = ANY(${sql.raw(uuidArrayLiteral(tripIds))})`);
      }
      if (inspectionIds.length > 0) {
        parts.push(sql`inspection_id = ANY(${sql.raw(uuidArrayLiteral(inspectionIds))})`);
      }
      if (parts.length === 0) return null;
      return sql`(${sql.join(parts, sql` OR `)})`;
    }
    // -- notifications caused by removed operational entities
    case 'notifications': {
      const parts: SQL[] = [];
      if (notificationIds.length > 0) {
        parts.push(sql`id = ANY(${sql.raw(uuidArrayLiteral(notificationIds))})`);
      }
      if (removedEntityIds.length > 0) {
        parts.push(sql`entity_id = ANY(${sql.raw(uuidArrayLiteral(removedEntityIds))})`);
      }
      if (parts.length === 0) return null;
      return sql`tenant_id = ${tenantId} AND (${sql.join(parts, sql` OR `)})`;
    }
    // -- share links for removed documents
    case 'share_links': {
      if (documentIds.length === 0) return null;
      return sql`document_id = ANY(${sql.raw(uuidArrayLiteral(documentIds))})`;
    }
    default:
      break;
  }

  // Generic scoping by the step's declared scope column.
  const scopeValue: { column: string; values: string[] } | null = (() => {
    switch (step.scope) {
      case 'request':
        return { column: 'request_id', values: requestIds };
      case 'trip':
        return { column: 'trip_id', values: tripIds };
      case 'allocation':
        return { column: 'allocation_id', values: allocationIds };
      case 'authority':
        return { column: 'authority_id', values: authorityIds };
      case 'inspection':
        return { column: 'inspection_id', values: inspectionIds };
      case 'fuel':
        return { column: 'transaction_id', values: fuelIds };
      case 'workflowInstance':
        return { column: 'instance_id', values: workflowIds };
      case 'document':
        return { column: 'document_id', values: documentIds };
      case 'tenant':
        return { column: 'tenant_id', values: [tenantId] };
      case 'notification':
        return null;
    }
  })();

  if (!scopeValue || scopeValue.values.length === 0) return null;

  if (step.table === 'transport_requests') {
    return sql`tenant_id = ${tenantId}`;
  }
  if (step.table === 'trips') {
    // trips.scope is request-based (trips.request_id IN tenant request ids)
    return sql`request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`;
  }
  if (step.table === 'vehicle_allocations') {
    return sql`request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`;
  }
  if (step.table === 'trip_authorities') {
    return sql`request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`;
  }
  if (step.table === 'workflow_instances') {
    return sql`request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`;
  }
  if (step.table === 'fuel_transactions') {
    return sql`trip_id = ANY(${sql.raw(uuidArrayLiteral(tripIds))})`;
  }

  return sql`${sql.raw(scopeValue.column)} = ANY(${sql.raw(uuidArrayLiteral(scopeValue.values))})`;
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

async function collectEntityIds(db: ResetDb, tenantId: string): Promise<EntityIdSets> {
  const requestIds = await collectIds(
    db,
    sql`SELECT id FROM ${sql.raw(quoteTable('transport_requests'))} WHERE tenant_id = ${tenantId}`,
  );

  // No operational requests → nothing further to collect.
  if (requestIds.length === 0) {
    return {
      requestIds,
      tripIds: [],
      allocationIds: [],
      authorityIds: [],
      inspectionIds: [],
      fuelTransactionIds: [],
      workflowInstanceIds: [],
      generatedDocumentIds: [],
      notificationIds: [],
      removedEntityIds: [],
    };
  }

  const [tripIds, allocationIds, authorityIds, workflowInstanceIds] = await Promise.all([
    collectIds(
      db,
      sql`SELECT id FROM ${sql.raw(quoteTable('trips'))} WHERE request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`,
    ),
    collectIds(
      db,
      sql`SELECT id FROM ${sql.raw(quoteTable('vehicle_allocations'))} WHERE request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`,
    ),
    collectIds(
      db,
      sql`SELECT id FROM ${sql.raw(quoteTable('trip_authorities'))} WHERE request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`,
    ),
    collectIds(
      db,
      sql`SELECT id FROM ${sql.raw(quoteTable('workflow_instances'))} WHERE request_id = ANY(${sql.raw(uuidArrayLiteral(requestIds))})`,
    ),
  ]);

  const [inspectionIds, fuelTransactionIds] = await Promise.all([
    collectIds(
      db,
      sql`SELECT id FROM ${sql.raw(quoteTable('vehicle_inspections'))} WHERE tenant_id = ${tenantId} AND trip_id = ANY(${sql.raw(uuidArrayLiteral(tripIds))})`,
    ),
    collectIds(
      db,
      sql`SELECT id FROM ${sql.raw(quoteTable('fuel_transactions'))} WHERE trip_id = ANY(${sql.raw(uuidArrayLiteral(tripIds))})`,
    ),
  ]);

  const removedEntityIds = [
    ...requestIds,
    ...tripIds,
    ...allocationIds,
    ...authorityIds,
    ...inspectionIds,
    ...fuelTransactionIds,
    ...workflowInstanceIds,
  ];

  const [generatedDocumentIds, notificationIds] = await Promise.all([
    collectIds(
      db,
      sql`SELECT id FROM ${sql.raw(quoteTable('generated_documents'))} WHERE tenant_id = ${tenantId} AND entity_id = ANY(${sql.raw(uuidArrayLiteral(removedEntityIds))})`,
    ),
    collectIds(
      db,
      sql`SELECT n.id FROM ${sql.raw(quoteTable('notifications'))} n WHERE n.tenant_id = ${tenantId} AND (
        n.entity_id = ANY(${sql.raw(uuidArrayLiteral(removedEntityIds))}) OR
        (n.entity_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM transport_requests tr WHERE tr.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM trips tp WHERE tp.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM vehicle_allocations va WHERE va.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM trip_authorities ta WHERE ta.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM fuel_transactions ft WHERE ft.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM workflow_instances wi WHERE wi.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM generated_documents gd WHERE gd.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM maintenance_events me WHERE me.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM programmes p WHERE p.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM regions rg WHERE rg.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM driver_licences dl WHERE dl.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM employees em WHERE em.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM offices ofc WHERE ofc.id = n.entity_id)
          AND NOT EXISTS (SELECT 1 FROM departments dp WHERE dp.id = n.entity_id))
      )`,
    ),
  ]);

  return {
    requestIds,
    tripIds,
    allocationIds,
    authorityIds,
    inspectionIds,
    fuelTransactionIds,
    workflowInstanceIds,
    generatedDocumentIds,
    notificationIds,
    removedEntityIds: [...removedEntityIds, ...generatedDocumentIds],
  };
}

function parseStorageKey(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .join(',');
  }
  return null;
}

async function collectStorageKeys(
  db: ResetDb,
  steps: StepPlan[],
  ids: EntityIdSets,
  tenantId: string,
): Promise<string[]> {
  const keys: string[] = [];
  for (const step of steps) {
    if (!step.fileKeyColumns || step.fileKeyColumns.length === 0) continue;
    const condition = resolveStepCondition(
      { table: step.table, label: step.label, scope: step.scope, fileKeyColumns: step.fileKeyColumns },
      ids,
      tenantId,
    );
    if (!condition) continue;
    // Join the column *names* — sql.raw() returns a SQL object whose String()
    // is "[object Object]", so it must be applied to the final joined string.
    const selectColumns = step.fileKeyColumns.join(', ');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = sql`SELECT ${sql.raw(selectColumns)} FROM ${sql.raw(quoteTable(step.table))} WHERE ${condition}` as any;
    const rows = await queryRows(db, query);
    for (const row of rows) {
      for (const col of step.fileKeyColumns) {
        const key = parseStorageKey(row[col]);
        if (key) keys.push(...key.split(','));
      }
    }
  }
  return [...new Set(keys.filter((k) => k.length > 0))];
}

async function countTable(db: ResetDb, table: string): Promise<number> {
  return queryCount(db, sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable(table))}`);
}

/**
 * Count a preserved table's rows scoped to the selected tenant.
 *
 * Several preserved tables have no `tenant_id` column of their own (they are
 * scoped through a parent: tenant memberships, roles, employees, driver
 * profiles/licences). Each case below joins through to the tenant exactly as
 * the rest of the schema does, so the preserved counts are accurate rather
 * than global.
 */
function countPreservedTable(
  db: ResetDb,
  table: string,
  tenantId: string,
): Promise<number> {
  switch (table) {
    case 'employee_number_counters':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('employee_number_counters'))} WHERE tenant_id = ${tenantId}`,
      );
    case 'role_assignments':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('role_assignments'))} ra JOIN ${sql.raw(quoteTable('tenant_memberships'))} tm ON tm.id = ra.tenant_membership_id WHERE tm.tenant_id = ${tenantId}`,
      );
    case 'role_permissions':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('role_permissions'))} rp JOIN ${sql.raw(quoteTable('roles'))} r ON r.id = rp.role_id WHERE r.tenant_id = ${tenantId}`,
      );
    case 'workflow_steps':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('workflow_steps'))} ws JOIN ${sql.raw(quoteTable('workflow_definitions'))} wd ON wd.id = ws.definition_id WHERE wd.tenant_id = ${tenantId}`,
      );
    case 'inspection_template_items':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('inspection_template_items'))} iti JOIN ${sql.raw(quoteTable('inspection_templates'))} it ON it.id = iti.template_id WHERE it.tenant_id = ${tenantId}`,
      );
    case 'employee_documents':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('employee_documents'))} ed JOIN ${sql.raw(quoteTable('employees'))} e ON e.id = ed.employee_id WHERE e.tenant_id = ${tenantId}`,
      );
    case 'driver_profiles':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('driver_profiles'))} dp JOIN ${sql.raw(quoteTable('employees'))} e ON e.id = dp.employee_id WHERE e.tenant_id = ${tenantId}`,
      );
    case 'driver_licences':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('driver_licences'))} dl JOIN ${sql.raw(quoteTable('driver_profiles'))} dp ON dp.id = dl.driver_profile_id JOIN ${sql.raw(quoteTable('employees'))} e ON e.id = dp.employee_id WHERE e.tenant_id = ${tenantId}`,
      );
    case 'driver_licence_codes':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('driver_licence_codes'))} dlc JOIN ${sql.raw(quoteTable('driver_licences'))} dl ON dl.id = dlc.licence_id JOIN ${sql.raw(quoteTable('driver_profiles'))} dp ON dp.id = dl.driver_profile_id JOIN ${sql.raw(quoteTable('employees'))} e ON e.id = dp.employee_id WHERE e.tenant_id = ${tenantId}`,
      );
    case 'driver_professional_authorisations':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('driver_professional_authorisations'))} dpa JOIN ${sql.raw(quoteTable('driver_profiles'))} dp ON dp.id = dpa.driver_profile_id JOIN ${sql.raw(quoteTable('employees'))} e ON e.id = dp.employee_id WHERE e.tenant_id = ${tenantId}`,
      );
    case 'driver_licence_corrections':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('driver_licence_corrections'))} dlc JOIN ${sql.raw(quoteTable('driver_licences'))} dl ON dl.id = dlc.licence_id JOIN ${sql.raw(quoteTable('driver_profiles'))} dp ON dp.id = dl.driver_profile_id JOIN ${sql.raw(quoteTable('employees'))} e ON e.id = dp.employee_id WHERE e.tenant_id = ${tenantId}`,
      );
    case 'user':
      return countTable(db, 'user');
    case 'user_profiles':
      return queryCount(
        db,
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('user_profiles'))} WHERE user_id IN (SELECT id FROM "user")`,
      );
    case 'tenants':
    case 'permissions':
    case 'session':
    case 'account':
    case 'verification':
      return countTable(db, table);
    default:
      // Tenant-scoped tables carry their own tenant_id column.
      return queryCount(
        db,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable(table))} WHERE tenant_id = ${tenantId}` as any,
      );
  }
}

/**
 * Build the full reset plan for a tenant. Never mutates data.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate the tenant id. It is interpolated into raw SQL in some places
 * (integrity checks), so it must be a strict UUID — never free-form input.
 */
function assertTenantId(tenantId: string): void {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(
      `Invalid tenant id "${tenantId}". Expected a UUID (e.g. 00000000-0000-0000-0000-000000000001).`,
    );
  }
}

export async function buildResetPlan(
  db: ResetDb,
  opts: { tenantId: string; mode: ResetMode; dryRun: boolean; timestamp: string },
): Promise<ResetPlan> {
  const { tenantId, mode, dryRun, timestamp } = opts;
  assertTenantId(tenantId);

  const tenantRows = await queryRows(
    db,
    sql`SELECT id, name, code FROM ${sql.raw(quoteTable('tenants'))} WHERE id = ${tenantId}`,
  );
  const tenantRow = tenantRows[0] as { id?: unknown; name?: unknown; code?: unknown } | undefined;
  if (!tenantRow || !tenantRow.name) {
    throw new Error(`Tenant not found for id "${tenantId}". Check --tenant=<id>.`);
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL || '';
  let database = 'unknown';
  try {
    database = new URL(databaseUrl).host;
  } catch {
    database = databaseUrl ? 'unparsable-url' : 'not-configured';
  }

  const ids = await collectEntityIds(db, tenantId);

  // Per-step counts using the same conditions that will drive the deletes.
  const steps: StepPlan[] = [];
  for (const step of OPERATIONAL_DELETE_STEPS) {
    const condition = resolveStepCondition(step, ids, tenantId);
    const before =
      condition === null
        ? 0
        : await queryCount(
            db,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable(step.table))} WHERE ${condition}` as any,
          );
    steps.push({
      table: step.table,
      label: step.label,
      before,
      fileKeyColumns: step.fileKeyColumns,
      scope: step.scope,
    });
  }

  const fileKeys = await collectStorageKeys(db, steps, ids, tenantId);

  // Requires-review records (counted but never deleted by the default mode).
  const review: ReviewItem[] = [];
  for (const item of REVIEW_ONLY_TABLES) {
    let count = 0;
    switch (item.table) {
      case 'maintenance_events': {
        const vehicleIds = await collectIds(
          db,
          sql`SELECT id FROM ${sql.raw(quoteTable('vehicles'))} WHERE tenant_id = ${tenantId}`,
        );
        if (vehicleIds.length > 0) {
          count = await queryCount(
            db,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('maintenance_events'))} WHERE vehicle_id = ANY(${sql.raw(uuidArrayLiteral(vehicleIds))})` as any,
          );
        }
        break;
      }
      case 'vehicle_documents': {
        const vehicleIds = await collectIds(
          db,
          sql`SELECT id FROM ${sql.raw(quoteTable('vehicles'))} WHERE tenant_id = ${tenantId}`,
        );
        if (vehicleIds.length > 0) {
          count = await queryCount(
            db,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('vehicle_documents'))} WHERE vehicle_id = ANY(${sql.raw(uuidArrayLiteral(vehicleIds))})` as any,
          );
        }
        break;
      }
      case 'programmes':
      case 'import_batches':
      case 'tenant_holidays':
        count = await queryCount(
          db,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable(item.table))} WHERE tenant_id = ${tenantId}` as any,
        );
        break;
    }
    review.push({ table: item.table, label: item.label, reason: item.reason, count });
  }

  // Preserved reference data counts for the before/after report.
  const preserved: Array<{ table: string; label: string; count: number }> = [];
  for (const entry of PRESERVED_TABLES) {
    const count = await countPreservedTable(db, entry.table, tenantId);
    preserved.push({ table: entry.table, label: entry.label, count });
  }

  // Operational reference markers used for demo identification (informational).

  const seededRequests = await queryCount(
    db,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sql`SELECT COUNT(*) AS count FROM ${sql.raw(quoteTable('transport_requests'))} WHERE tenant_id = ${tenantId} AND (reference LIKE 'GRN/TR/%' OR reference LIKE 'GRN/RR/%')` as any,
  );

  return {
    tenantId,
    tenantName: String(tenantRow.name),
    tenantCode: String(tenantRow.code ?? ''),
    mode,
    dryRun,
    database,
    timestamp,
    ids,
    steps,
    fileKeys,
    review,
    preserved: [...preserved, { table: 'transport_requests', label: 'Seeded operational requests (marker)', count: seededRequests }],
  };
}
