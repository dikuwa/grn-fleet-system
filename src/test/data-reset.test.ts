/**
 * Development Data Reset — unit tests
 *
 * Covers the safety guards, plan scoping, engine orchestration (dry-run,
 * execute, transaction rollback) and demo account/vehicle classification.
 * All database interactions use a fake `ResetDb` so no real database is
 * touched.
 */
import { describe, it, expect } from 'vitest';
import { checkResetAllowed, checkConfirmationPhrase } from '@/lib/data-reset/guard';
import { resolveStepCondition, type ResetDb, type EntityIdSets } from '@/lib/data-reset/plan';
import { runDevelopmentDataReset } from '@/lib/data-reset/engine';
import {
  listDemoAccounts,
  listDemoVehicles,
  deleteDemoVehicles,
  deleteDemoAccounts,
} from '@/lib/data-reset/demo';
import {
  DATA_RESET_CONFIRMATION_PHRASE,
  OPERATIONAL_DELETE_STEPS,
  SEED_TENANT_ID,
} from '@/lib/data-reset/config';

const TENANT_ID = SEED_TENANT_ID;

const IDS: EntityIdSets = {
  requestIds: ['req-1', 'req-2'],
  tripIds: ['trip-1'],
  allocationIds: ['alloc-1'],
  authorityIds: ['auth-1'],
  inspectionIds: ['insp-1'],
  fuelTransactionIds: ['fuel-1'],
  workflowInstanceIds: ['wf-1'],
  generatedDocumentIds: ['doc-1'],
  notificationIds: ['notif-1'],
  removedEntityIds: ['req-1', 'req-2', 'trip-1', 'alloc-1', 'auth-1', 'insp-1', 'fuel-1', 'wf-1', 'doc-1'],
};

// ---------------------------------------------------------------------------
// Fake db
// ---------------------------------------------------------------------------

/**
 * Serialize a drizzle SQL value to its SQL text so the fake db and the
 * condition assertions can inspect it. Falls back to String() otherwise.
 */
function sqlText(query: unknown): string {
  const sqlValue = query as {
    toQuery?: (config: {
      escapeName: (name: string) => string;
      escapeParam: (num: number, value: unknown) => string;
      escapeString: (str: string) => string;
    }) => { sql: string };
  };
  if (typeof sqlValue?.toQuery === 'function') {
    return sqlValue.toQuery({
      escapeName: (name: string) => name,
      escapeParam: (_num: number, value: unknown) => {
        if (value === null) return 'NULL';
        if (typeof value === 'number') return String(value);
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        return `'${String(value).replace(/'/g, "''")}'`;
      },
      escapeString: (str: string) => `'${str.replace(/'/g, "''")}'`,
    }).sql;
  }
  return String(query);
}

/** Normalize whitespace so multi-line SQL templates still match includes(). */
function normalized(query: unknown): string {
  return sqlText(query).replace(/\s+/g, ' ');
}

function makeFakeDb(opts?: {
  failDelete?: (text: string) => boolean;
  withTransaction?: boolean;
}): { db: ResetDb; calls: string[]; deletes: string[] } {
  const calls: string[] = [];
  const deletes: string[] = [];
  const db: ResetDb = {
    execute: async (query: unknown) => {
      const text = normalized(query);
      calls.push(text);
      const lower = text.toLowerCase();

      if (lower.startsWith('delete from')) {
        if (opts?.failDelete?.(text)) {
          throw new Error(`Simulated failure for ${text.slice(0, 60)}`);
        }
        deletes.push(text);
        return { rows: [] };
      }

      if (lower.includes('from "tenants" where')) {
        return {
          rows: [{ id: TENANT_ID, name: 'Kavango East Regional Council', code: 'KERC' }],
        };
      }
      if (lower.includes('select id from "transport_requests" where')) {
        return { rows: [{ id: 'req-1' }, { id: 'req-2' }] };
      }
      if (lower.includes('select id from "trips" where')) {
        return { rows: [{ id: 'trip-1' }] };
      }
      if (lower.includes('select id from "vehicle_allocations" where')) {
        return { rows: [{ id: 'alloc-1' }] };
      }
      if (lower.includes('select id from "trip_authorities" where')) {
        return { rows: [{ id: 'auth-1' }] };
      }
      if (lower.includes('select id from "workflow_instances" where')) {
        return { rows: [{ id: 'wf-1' }] };
      }
      if (lower.includes('select id from "vehicle_inspections" where')) {
        return { rows: [{ id: 'insp-1' }] };
      }
      if (lower.includes('select id from "fuel_transactions" where')) {
        return { rows: [{ id: 'fuel-1' }] };
      }
      if (lower.includes('select id from "generated_documents" where')) {
        return { rows: [{ id: 'doc-1' }] };
      }
      if (lower.includes('select id from "notifications" where')) {
        return { rows: [{ id: 'notif-1' }] };
      }
      if (lower.includes('select id from "vehicles" where')) {
        return { rows: [{ id: 'vehicle-1' }] };
      }
      if (lower.includes('select count(*) as count')) {
        return { rows: [{ count: 3 }] };
      }
      return { rows: [] };
    },
  };
  if (opts?.withTransaction) {
    db.transaction = async (callback) => callback(db);
  }
  return { db, calls, deletes };
}

const ALLOWED_ENV = { ALLOW_DEV_DATA_RESET: 'true', NODE_ENV: 'development' };

// ---------------------------------------------------------------------------
// Guard tests
// ---------------------------------------------------------------------------

describe('data reset guards', () => {
  it('allows when ALLOW_DEV_DATA_RESET=true and no production signals', () => {
    const result = checkResetAllowed({ ...ALLOWED_ENV, DATABASE_URL: 'postgres://localhost:5432/dev' });
    expect(result.allowed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('blocks when NODE_ENV=production', () => {
    const result = checkResetAllowed({ ...ALLOWED_ENV, NODE_ENV: 'production' });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(' ')).toContain('production');
  });

  it('blocks when VERCEL_ENV=production', () => {
    const result = checkResetAllowed({ ...ALLOWED_ENV, VERCEL_ENV: 'production' });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(' ')).toContain('production');
  });

  it('blocks when ALLOW_DEV_DATA_RESET is not "true"', () => {
    const result = checkResetAllowed({ ALLOW_DEV_DATA_RESET: 'false', NODE_ENV: 'development' });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(' ')).toContain('ALLOW_DEV_DATA_RESET');
  });

  it('blocks when the flag is missing entirely', () => {
    const result = checkResetAllowed({ NODE_ENV: 'development' });
    expect(result.allowed).toBe(false);
  });

  it('warns (but does not block) for a non-local database host', () => {
    const result = checkResetAllowed({
      ...ALLOWED_ENV,
      DATABASE_URL: 'postgres://user:pass@db.example.com:5432/dev',
    });
    expect(result.allowed).toBe(true);
    expect(result.warnings.join(' ')).toContain('non-local host');
  });

  it('blocks a production-looking database host', () => {
    const result = checkResetAllowed({
      ...ALLOWED_ENV,
      DATABASE_URL: 'postgres://user:pass@ep-123.prod.aws.neon.tech:5432/grn',
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.join(' ')).toContain('production');
  });
});

describe('confirmation phrase', () => {
  it('accepts the exact phrase', () => {
    const result = checkConfirmationPhrase(DATA_RESET_CONFIRMATION_PHRASE);
    expect(result.allowed).toBe(true);
  });

  it('rejects a wrong or missing phrase', () => {
    expect(checkConfirmationPhrase(undefined).allowed).toBe(false);
    expect(checkConfirmationPhrase('WRONG PHRASE').allowed).toBe(false);
    expect(checkConfirmationPhrase('reset grn fleet development data').allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plan scoping tests
// ---------------------------------------------------------------------------

describe('resolveStepCondition', () => {
  it('scopes transport_requests to the tenant id', () => {
    const condition = resolveStepCondition(
      { table: 'transport_requests', label: '', scope: 'tenant' },
      IDS,
      TENANT_ID,
    );
    expect(condition).not.toBeNull();
    expect(sqlText(condition)).toContain('tenant_id');
  });

  it('scopes request children by request_id', () => {
    const condition = resolveStepCondition(
      { table: 'request_attachments', label: '', scope: 'request' },
      IDS,
      TENANT_ID,
    );
    expect(sqlText(condition)).toContain('request_id');
  });

  it('inlines the id set as a Postgres array literal (regression: no parameter spread)', () => {
    // drizzle expands JS arrays into separate $1,$2 parameters, producing
    // `ANY(($1,$2)::uuid[])` — a row constructor Postgres rejects with
    // "cannot cast type record to uuid[]". The reset tooling must emit an
    // inline ARRAY[...]::uuid[] literal instead.
    const condition = resolveStepCondition(
      { table: 'request_attachments', label: '', scope: 'request' },
      IDS,
      TENANT_ID,
    );
    const text = sqlText(condition);
    expect(text).toMatch(/ANY\(ARRAY\['req-1','req-2'\]::uuid\[\]\)/i);
    // The broken form has the id set spread into parameters:
    expect(text).not.toMatch(/ANY\(\$\d/);
  });

  it('scopes trip children by trip_id', () => {
    const condition = resolveStepCondition(
      { table: 'trip_log_entries', label: '', scope: 'trip' },
      IDS,
      TENANT_ID,
    );
    expect(sqlText(condition)).toContain('trip_id');
  });

  it('scopes generated_documents by tenant + removed entity ids', () => {
    const condition = resolveStepCondition(
      { table: 'generated_documents', label: '', scope: 'request' },
      IDS,
      TENANT_ID,
    );
    expect(sqlText(condition)).toContain('tenant_id');
    expect(sqlText(condition)).toContain('entity_id');
  });

  it('scopes notifications by tenant + removed entity ids', () => {
    const condition = resolveStepCondition(
      { table: 'notifications', label: '', scope: 'notification' },
      IDS,
      TENANT_ID,
    );
    expect(sqlText(condition)).toContain('tenant_id');
    expect(sqlText(condition)).toContain('entity_id');
  });

  it('scopes trip-sourced odometer events by trip id (regression: trip_return events)', () => {
    // Regression (live DB): trip_return odometer events carry the trip id in
    // source_entity_id but were never matched — only inspection/fuel sources
    // were. They survived the reset and blocked Mode C demo-vehicle deletion.
    const condition = resolveStepCondition(
      { table: 'vehicle_odometer_events', label: '', scope: 'inspection' },
      IDS,
      TENANT_ID,
    );
    const text = sqlText(condition);
    expect(text).toMatch(/source_entity_type = 'trip' AND source_entity_id = ANY\(ARRAY\['trip-1'\]::uuid\[\]\)/i);
    expect(text).toMatch(/source_entity_type = 'inspection'/i);
    expect(text).toMatch(/source_entity_type = 'fuel_transaction'/i);
  });

  it('omits the trip branch when no trips are targeted (odometer events)', () => {
    const emptyTrips: EntityIdSets = {
      ...IDS,
      tripIds: [],
      removedEntityIds: IDS.removedEntityIds.filter((id) => id !== 'trip-1'),
    };
    const condition = resolveStepCondition(
      { table: 'vehicle_odometer_events', label: '', scope: 'inspection' },
      emptyTrips,
      TENANT_ID,
    );
    expect(condition).not.toBeNull();
    const text = sqlText(condition);
    expect(text).not.toMatch(/source_entity_type = 'trip'/i);
    expect(text).toMatch(/source_entity_type = 'inspection'/i);
  });

  it('returns null for odometer events when every source id set is empty', () => {
    const empty: EntityIdSets = {
      requestIds: [],
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
    expect(
      resolveStepCondition({ table: 'vehicle_odometer_events', label: '', scope: 'inspection' }, empty, TENANT_ID),
    ).toBeNull();
  });

  it('uses a text[] literal for text-typed id columns (vehicle_status_events)', () => {
    // reference_entity_id is text, so ANY(...) must be text[], not uuid[].
    const condition = resolveStepCondition(
      { table: 'vehicle_status_events', label: '', scope: 'trip' },
      IDS,
      TENANT_ID,
    );
    const text = sqlText(condition);
    expect(text).toMatch(/reference_entity_id = ANY\(ARRAY\['trip-1','alloc-1'\]::text\[\]\)/i);
    expect(text).not.toMatch(/ANY\(ARRAY\[.*\]::uuid\[\]\)/i);
  });

  it('returns null when the target id set is empty (nothing to delete)', () => {
    const empty: EntityIdSets = {
      requestIds: [],
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
    expect(
      resolveStepCondition({ table: 'trips', label: '', scope: 'request' }, empty, TENANT_ID),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Engine tests
// ---------------------------------------------------------------------------

describe('runDevelopmentDataReset', () => {
  it('dry-run deletes nothing and reports planned counts', async () => {
    const { db, deletes } = makeFakeDb();
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: true,
      dbOverride: db,
      skipFiles: true,
      envOverrides: ALLOWED_ENV,
    });
    expect(outcome.report.dryRun).toBe(true);
    expect(outcome.report.result).toBe('dry_run');
    expect(outcome.report.dryRunSummary.requests).toBe(2);
    expect(outcome.report.dryRunSummary.trips).toBe(1);
    expect(outcome.report.dryRunSummary.total).toBeGreaterThan(0);
    expect(deletes).toHaveLength(0);
  });

  it('blocks execution without the confirmation phrase', async () => {
    const { db, deletes } = makeFakeDb();
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: false,
      confirmPhrase: 'wrong',
      dbOverride: db,
      skipFiles: true,
      envOverrides: ALLOWED_ENV,
    });
    expect(outcome.report.result).toBe('failed');
    expect(outcome.report.errors.join(' ')).toContain('Confirmation phrase');
    expect(deletes).toHaveLength(0);
  });

  it('blocks execution when the environment flag is missing', async () => {
    const { db, deletes } = makeFakeDb();
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: false,
      confirmPhrase: DATA_RESET_CONFIRMATION_PHRASE,
      dbOverride: db,
      skipFiles: true,
      envOverrides: { NODE_ENV: 'development' },
    });
    expect(outcome.report.result).toBe('failed');
    expect(outcome.report.errors.join(' ')).toContain('ALLOW_DEV_DATA_RESET');
    expect(deletes).toHaveLength(0);
  });

  it('executes deletes in foreign-key-safe order for the tenant', async () => {
    const { db, deletes } = makeFakeDb();
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: false,
      confirmPhrase: DATA_RESET_CONFIRMATION_PHRASE,
      dbOverride: db,
      skipFiles: true,
      envOverrides: ALLOWED_ENV,
    });
    expect(outcome.report.result).toBe('completed');
    expect(deletes.length).toBeGreaterThan(0);

    const deleteTables = deletes.map((text) => {
      const match = text.match(/delete from "([a-z_]+)"/i);
      return match ? match[1] : '';
    });
    const order = OPERATIONAL_DELETE_STEPS.map((step) => step.table);
    // trips carry an allocation_id FK to vehicle_allocations (RESTRICT), so
    // allocations must be deleted AFTER trips.
    const importantOrder = [
      'share_links',
      'generated_documents',
      'trip_authorities',
      'vehicle_inspections',
      'trips',
      'vehicle_allocations',
      'transport_requests',
      'notifications',
    ];
    const positions = importantOrder.map((table) => deleteTables.indexOf(table));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    expect(deleteTables.filter((t) => order.includes(t)).length).toBe(deleteTables.length);
    expect(outcome.report.steps.every((step) => step.planned === step.removed)).toBe(true);
  });

  it('rolls back and reports failure when a step fails inside a transaction', async () => {
    const { db, deletes } = makeFakeDb({
      withTransaction: true,
      failDelete: (text) => text.toLowerCase().includes('delete from "share_links"'),
    });
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: false,
      confirmPhrase: DATA_RESET_CONFIRMATION_PHRASE,
      dbOverride: db,
      skipFiles: true,
      envOverrides: ALLOWED_ENV,
    });
    expect(outcome.report.result).toBe('failed');
    expect(outcome.report.errors.join(' ')).toMatch(/aborted|transaction/i);
    expect(outcome.report.steps.every((step) => step.removed === 0)).toBe(true);
    // A failed first step means no subsequent deletes were attempted.
    expect(deletes).toHaveLength(0);
  });

  it('selects real storage-key columns when collecting file keys', async () => {
    // Regression: sql.raw() on each column then .join() produced
    // "SELECT [object Object] FROM …" — the file key query must contain the
    // actual column names.
    const db: ResetDb = {
      execute: async (query: unknown) => {
        const text = normalized(query).toLowerCase();
        if (text.includes('from "tenants" where')) {
          return { rows: [{ id: TENANT_ID, name: 'Kavango East Regional Council', code: 'KERC' }] };
        }
        if (text.includes('select id from "transport_requests" where')) {
          return { rows: [{ id: 'req-1' }, { id: 'req-2' }] };
        }
        if (text.includes('select file_key from "generated_documents"')) {
          return { rows: [{ file_key: 'docs/a.pdf' }, { file_key: 'docs/b.pdf' }] };
        }
        if (text.includes('select count(*) as count')) {
          return { rows: [{ count: 3 }] };
        }
        return { rows: [] };
      },
    };
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: true,
      dbOverride: db,
      skipFiles: true,
      envOverrides: ALLOWED_ENV,
    });
    expect(outcome.report.storageFilesSkipped).toBe(2);
    expect(outcome.plan.fileKeys).toEqual(['docs/a.pdf', 'docs/b.pdf']);
  });

  it('falls back to staged execution when the driver exposes but does not support transactions', async () => {
    // neon-http's db.transaction() throws "No transactions support" before
    // running the callback — the engine must treat that as the staged path,
    // not as a rollback failure.
    const { db, deletes } = makeFakeDb();
    const neonDb: ResetDb = {
      ...db,
      transaction: async () => {
        throw new Error('No transactions support in neon-http driver');
      },
    };
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: false,
      confirmPhrase: DATA_RESET_CONFIRMATION_PHRASE,
      dbOverride: neonDb,
      skipFiles: true,
      skipStorage: true,
      envOverrides: ALLOWED_ENV,
    });
    expect(outcome.report.result).toBe('completed');
    expect(deletes.length).toBeGreaterThan(0);
    expect(outcome.report.errors.some((e) => e.includes('No transactions support'))).toBe(false);
  });

  it('preserves tenant identity and configuration in the report', async () => {
    const { db } = makeFakeDb();
    const outcome = await runDevelopmentDataReset({
      tenantId: TENANT_ID,
      mode: 'operational',
      dryRun: true,
      dbOverride: db,
      skipFiles: true,
      envOverrides: ALLOWED_ENV,
    });
    expect(outcome.report.tenantName).toBe('Kavango East Regional Council');
    expect(outcome.report.preserved.some((item) => item.label === 'Staff')).toBe(true);
    expect(outcome.report.preserved.some((item) => item.label === 'Vehicles')).toBe(true);
    expect(outcome.report.preserved.some((item) => item.label === 'Role assignments')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Demo account / vehicle tests
// ---------------------------------------------------------------------------

describe('demo modes', () => {
  it('proposes only seed accounts with no roles, staff or tenant membership', async () => {
    const db: ResetDb = {
      execute: async (query: unknown) => {
        const text = normalized(query).toLowerCase();
        if (text.includes('from "user" u where')) {
          return {
            rows: [
              { id: 'user-seed-driver', email: 'driver@kavangoeast.test', name: 'Michael', username: 'driver', member_of_tenant: true, has_role: true, staff_linked: true },
              { id: 'user-seed-orphan', email: 'orphan@kavangoeast.test', name: null, username: null, member_of_tenant: false, has_role: false, staff_linked: false },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const { proposed, preserved } = await listDemoAccounts(db, TENANT_ID);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].email).toBe('orphan@kavangoeast.test');
    expect(preserved).toHaveLength(1);
    expect(preserved[0].email).toBe('driver@kavangoeast.test');
  });

  it('lists E2E demo vehicles and refuses deletion while operational records exist', async () => {
    const db: ResetDb = {
      execute: async (query: unknown) => {
        const text = normalized(query).toLowerCase();
        if (text.includes('from vehicles v where')) {
          return {
            rows: [
              { id: 'v-e2e', licence_number: 'E2E-SEDAN-001', make: 'Toyota', model: 'Corolla', status: 'available', has_operational_records: true },
            ],
          };
        }
        if (text.startsWith('delete from')) return { rows: [] };
        return { rows: [] };
      },
    };
    const vehicles = await listDemoVehicles(db, TENANT_ID);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].licenceNumber).toBe('E2E-SEDAN-001');

    const result = await deleteDemoVehicles(db, TENANT_ID, ['v-e2e']);
    expect(result.deleted).toBe(0);
    expect(result.blocked.length).toBeGreaterThan(0);
  });

  it('deletes only explicitly approved demo accounts and blocks the rest', async () => {
    const db: ResetDb = {
      execute: async (query: unknown) => {
        const text = normalized(query).toLowerCase();
        if (text.includes('from "user" u where')) {
          return {
            rows: [
              { id: 'user-seed-orphan', email: 'orphan@kavangoeast.test', name: null, username: null, member_of_tenant: false, has_role: false, staff_linked: false },
              { id: 'user-seed-driver', email: 'driver@kavangoeast.test', name: 'Michael', username: 'driver', member_of_tenant: true, has_role: true, staff_linked: true },
            ],
          };
        }
        if (text.startsWith('delete from')) return { rows: [] };
        return { rows: [] };
      },
    };
    const result = await deleteDemoAccounts(db, TENANT_ID, ['user-seed-orphan', 'user-seed-driver']);
    expect(result.deleted).toBe(1);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].userId).toBe('user-seed-driver');
  });

  it('deletes demo vehicles with no operational records', async () => {
    const db: ResetDb = {
      execute: async (query: unknown) => {
        const text = normalized(query).toLowerCase();
        if (text.includes('from vehicles v where')) {
          return {
            rows: [
              { id: 'v-e2e', licence_number: 'E2E-SEDAN-001', make: 'Toyota', model: 'Corolla', status: 'available', has_operational_records: false },
            ],
          };
        }
        if (text.startsWith('delete from')) return { rows: [] };
        return { rows: [] };
      },
    };
    const result = await deleteDemoVehicles(db, TENANT_ID, ['v-e2e']);
    expect(result.deleted).toBe(1);
    expect(result.blocked).toHaveLength(0);
  });

  it('removes notifications referencing the deleted fuel transactions and inspections', async () => {
    const deletes: string[] = [];
    const db: ResetDb = {
      execute: async (query: unknown) => {
        const text = normalized(query).toLowerCase();
        if (text.includes('from vehicles v where')) {
          return {
            rows: [
              { id: 'v-e2e', licence_number: 'E2E-SEDAN-001', make: 'Toyota', model: 'Corolla', status: 'available', has_operational_records: false },
            ],
          };
        }
        if (text.includes('select id from "fuel_transactions"')) {
          return { rows: [{ id: 'fuel-e2e' }] };
        }
        if (text.includes('select id from "vehicle_inspections"')) {
          return { rows: [{ id: 'insp-e2e' }] };
        }
        if (text.startsWith('delete from')) {
          deletes.push(text);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    const result = await deleteDemoVehicles(db, TENANT_ID, ['v-e2e']);
    expect(result.deleted).toBe(1);
    const notifDelete = deletes.find((d) => d.includes('delete from "notifications"'));
    expect(notifDelete).toBeTruthy();
    expect(notifDelete).toMatch(/entity_id = ANY\(ARRAY\['fuel-e2e','insp-e2e'\]::uuid\[\]\)/i);
    expect(notifDelete).toContain('tenant_id');
    // The notification delete must run before the fuel/inspection children are
    // removed (ids are collected first), i.e. before the vehicle row itself.
    expect(deletes.indexOf(notifDelete as string)).toBeLessThan(
      deletes.findIndex((d) => d.includes('delete from "vehicles"')),
    );
  });

  it('cleans RESTRICT-FK children (fuel transactions, inspections) before deleting demo vehicles', async () => {
    // Regression (live DB): fuel_transactions.vehicle_id and
    // vehicle_inspections.vehicle_id both reference vehicles.id WITHOUT
    // cascade, so deleting a vehicle without removing them first fails with
    // "violates foreign key constraint". reimbursements/fuel_receipts cascade
    // from fuel_transactions; inspection photos/results cascade from
    // vehicle_inspections.
    const deletes: string[] = [];
    const db: ResetDb = {
      execute: async (query: unknown) => {
        const text = normalized(query).toLowerCase();
        if (text.includes('from vehicles v where')) {
          return {
            rows: [
              { id: 'v-e2e', licence_number: 'E2E-SEDAN-001', make: 'Toyota', model: 'Corolla', status: 'available', has_operational_records: false },
            ],
          };
        }
        if (text.startsWith('delete from')) {
          deletes.push(text);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    const result = await deleteDemoVehicles(db, TENANT_ID, ['v-e2e']);
    expect(result.deleted).toBe(1);
    expect(result.blocked).toHaveLength(0);

    const tables = deletes.map((d) => (d.match(/delete from "?([a-z_]+)"?/i) ?? [])[1]);
    expect(tables).toContain('fuel_transactions');
    expect(tables).toContain('vehicle_inspections');
    // FK-restricted children must precede the vehicle row.
    expect(tables.indexOf('fuel_transactions')).toBeLessThan(tables.indexOf('vehicles'));
    expect(tables.indexOf('vehicle_inspections')).toBeLessThan(tables.indexOf('vehicles'));
    // vehicle_inspections before vehicle_defects: inspection_item_results
    // reference vehicle_defects (RESTRICT).
    expect(tables.indexOf('vehicle_inspections')).toBeLessThan(tables.indexOf('vehicle_defects'));
  });
});
