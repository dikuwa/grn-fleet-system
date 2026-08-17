import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { quoteTable, textArrayLiteral, uuidArrayLiteral } from '@/lib/data-reset/config';
import type { EntityIdSets, ResetDb, ResetPlan } from '@/lib/data-reset/plan';
import {
  RESET_ALWAYS_PROTECTED,
  normalizeResetSpec,
  type ResetCategoryId,
  type ResetSpec,
} from '@/lib/reset-catalog';

export interface AdvancedResetStep {
  table: string;
  label: string;
  category: ResetCategoryId;
  before: number;
  condition: SQL;
  fileKeyColumns?: string[];
}

export interface AdvancedResetPlan {
  tenantId: string;
  resetSpec: ResetSpec;
  protectedOwnerUserId: string | null;
  protectedMembershipIds: string[];
  steps: AdvancedResetStep[];
  categoryCounts: Partial<Record<ResetCategoryId, number>>;
  total: number;
  fingerprint: string;
  protected: readonly string[];
}

type StepDefinition = Omit<AdvancedResetStep, 'before'>;

const EMPTY_OPERATIONAL_IDS: EntityIdSets = {
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

async function rows(db: ResetDb, query: SQL) {
  return (await db.execute(query)).rows ?? [];
}

async function ids(db: ResetDb, query: SQL) {
  return (await rows(db, query))
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string');
}

async function count(db: ResetDb, table: string, condition: SQL) {
  const result = await rows(
    db,
    sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(quoteTable(table))} WHERE ${condition}`,
  );
  return Number(result[0]?.count ?? 0);
}

async function orderByForeignKeys(db: ResetDb, definitions: StepDefinition[]) {
  const byTable = new Map(definitions.map((definition) => [definition.table, definition]));
  const originalIndex = new Map(definitions.map((definition, index) => [definition.table, index]));
  const constraints = await rows(
    db,
    sql`
    SELECT child.relname AS child_table, parent.relname AS parent_table
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = child.relnamespace
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confdeltype IN ('a', 'r')
      AND namespace_row.nspname = 'public'
  `,
  );
  const outgoing = new Map<string, Set<string>>();
  const incomingCount = new Map(definitions.map((definition) => [definition.table, 0]));
  for (const constraint of constraints) {
    const child = String(constraint.child_table);
    const parent = String(constraint.parent_table);
    if (child === parent || !byTable.has(child) || !byTable.has(parent)) continue;
    const parents = outgoing.get(child) ?? new Set<string>();
    if (parents.has(parent)) continue;
    parents.add(parent);
    outgoing.set(child, parents);
    incomingCount.set(parent, (incomingCount.get(parent) ?? 0) + 1);
  }
  const ready = definitions
    .map((definition) => definition.table)
    .filter((table) => incomingCount.get(table) === 0);
  const ordered: StepDefinition[] = [];
  while (ready.length) {
    ready.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
    const table = ready.shift()!;
    ordered.push(byTable.get(table)!);
    for (const parent of outgoing.get(table) ?? []) {
      const remaining = (incomingCount.get(parent) ?? 1) - 1;
      incomingCount.set(parent, remaining);
      if (remaining === 0) ready.push(parent);
    }
  }
  if (ordered.length !== definitions.length) {
    throw new Error('Reset plan blocked: selected tables contain a restrictive foreign-key cycle');
  }
  return ordered;
}

function anyUuid(column: string, values: string[]) {
  return values.length
    ? sql`${sql.raw(column)} = ANY(${sql.raw(uuidArrayLiteral(values))})`
    : sql`FALSE`;
}

function notAnyUuid(column: string, values: string[]) {
  return values.length
    ? sql`(${sql.raw(column)} IS NULL OR NOT (${sql.raw(column)} = ANY(${sql.raw(uuidArrayLiteral(values))})))`
    : sql`TRUE`;
}

function anyText(column: string, values: string[]) {
  return values.length
    ? sql`${sql.raw(column)} = ANY(${sql.raw(textArrayLiteral(values))})`
    : sql`FALSE`;
}

async function protectedAccess(db: ResetDb, tenantId: string) {
  const candidates = await rows(
    db,
    sql`
    SELECT tm.id AS membership_id, tm.user_id AS user_id
    FROM tenant_memberships tm
    LEFT JOIN role_assignments ra ON ra.tenant_membership_id = tm.id
    LEFT JOIN roles r ON r.id = ra.role_id
    WHERE tm.tenant_id = ${tenantId} AND tm.status = 'active'
    ORDER BY CASE WHEN lower(COALESCE(r.name, '')) IN ('tenant administrator', 'tenant admin', 'owner') THEN 0 ELSE 1 END,
      tm.joined_at ASC
    LIMIT 1
  `,
  );
  const ownerMembershipId =
    typeof candidates[0]?.membership_id === 'string' ? candidates[0].membership_id : null;
  const ownerUserId = typeof candidates[0]?.user_id === 'string' ? candidates[0].user_id : null;
  const platformMemberships = await rows(
    db,
    sql`
    SELECT DISTINCT tm.id AS membership_id
    FROM tenant_memberships tm
    JOIN role_assignments ra ON ra.tenant_membership_id = tm.id
    JOIN roles r ON r.id = ra.role_id
    WHERE tm.tenant_id = ${tenantId}
      AND lower(r.name) IN ('platform super administrator', 'platform support administrator', 'platform auditor')
  `,
  );
  return {
    ownerUserId,
    membershipIds: [
      ...new Set([
        ...(ownerMembershipId ? [ownerMembershipId] : []),
        ...platformMemberships
          .map((row) => row.membership_id)
          .filter((id): id is string => typeof id === 'string'),
      ]),
    ],
  };
}

async function buildDefinitions(
  db: ResetDb,
  tenantId: string,
  spec: ResetSpec,
  operationalIds: EntityIdSets,
  ownerUserId: string | null,
  protectedMembershipIds: string[],
): Promise<StepDefinition[]> {
  const definitions: StepDefinition[] = [];
  const selected = new Set(spec.categories);
  const cutoff = spec.cutoff ? new Date(spec.cutoff) : null;

  if (selected.has('documents')) {
    const documentIds = await ids(
      db,
      cutoff
        ? sql`SELECT id FROM generated_documents WHERE tenant_id = ${tenantId} AND created_at < ${cutoff} AND ${notAnyUuid('id', operationalIds.generatedDocumentIds)}`
        : sql`SELECT id FROM generated_documents WHERE tenant_id = ${tenantId} AND ${notAnyUuid('id', operationalIds.generatedDocumentIds)}`,
    );
    const shareLinkIds = documentIds.length
      ? await ids(db, sql`SELECT id FROM share_links WHERE ${anyUuid('document_id', documentIds)}`)
      : [];
    const importBatchIds = await ids(
      db,
      cutoff
        ? sql`SELECT id FROM import_batches WHERE tenant_id = ${tenantId} AND created_at < ${cutoff}`
        : sql`SELECT id FROM import_batches WHERE tenant_id = ${tenantId}`,
    );
    definitions.push(
      {
        table: 'share_access_events',
        label: 'Document access events',
        category: 'documents',
        condition: anyUuid('share_link_id', shareLinkIds),
      },
      {
        table: 'share_links',
        label: 'Document share links',
        category: 'documents',
        condition: anyUuid('id', shareLinkIds),
      },
      {
        table: 'generated_documents',
        label: 'Standalone generated documents',
        category: 'documents',
        condition: anyUuid('id', documentIds),
        fileKeyColumns: ['file_key'],
      },
      {
        table: 'import_rows',
        label: 'Import row history',
        category: 'documents',
        condition: anyUuid('batch_id', importBatchIds),
      },
      {
        table: 'import_batches',
        label: 'Import files and history',
        category: 'documents',
        condition: anyUuid('id', importBatchIds),
        fileKeyColumns: ['file_key'],
      },
    );
  }

  if (selected.has('programmes')) {
    definitions.push({
      table: 'programmes',
      label: 'Programmes',
      category: 'programmes',
      condition: sql`tenant_id = ${tenantId}`,
    });
  }

  let vehicleIds: string[] = [];
  if (selected.has('fleet')) {
    vehicleIds = await ids(db, sql`SELECT id FROM vehicles WHERE tenant_id = ${tenantId}`);
    const fuelIds = vehicleIds.length
      ? await ids(
          db,
          sql`SELECT id FROM fuel_transactions WHERE ${anyUuid('vehicle_id', vehicleIds)} AND ${notAnyUuid('id', operationalIds.fuelTransactionIds)}`,
        )
      : [];
    const receiptIds = fuelIds.length
      ? await ids(db, sql`SELECT id FROM fuel_receipts WHERE ${anyUuid('transaction_id', fuelIds)}`)
      : [];
    const inspectionIds = vehicleIds.length
      ? await ids(
          db,
          sql`SELECT id FROM vehicle_inspections WHERE tenant_id = ${tenantId} AND ${anyUuid('vehicle_id', vehicleIds)} AND ${notAnyUuid('id', operationalIds.inspectionIds)}`,
        )
      : [];
    const operationalEventIds = [...operationalIds.tripIds, ...operationalIds.allocationIds];
    definitions.push(
      {
        table: 'receipt_field_corrections',
        label: 'Fuel receipt corrections',
        category: 'fleet',
        condition: anyUuid('receipt_id', receiptIds),
      },
      {
        table: 'reimbursements',
        label: 'Standalone reimbursements',
        category: 'fleet',
        condition: anyUuid('transaction_id', fuelIds),
      },
      {
        table: 'fuel_receipts',
        label: 'Standalone fuel receipts',
        category: 'fleet',
        condition: anyUuid('transaction_id', fuelIds),
        fileKeyColumns: ['file_key'],
      },
      {
        table: 'fuel_transactions',
        label: 'Standalone fuel transactions',
        category: 'fleet',
        condition: anyUuid('id', fuelIds),
      },
      {
        table: 'inspection_photos',
        label: 'Standalone inspection photos',
        category: 'fleet',
        condition: anyUuid('inspection_id', inspectionIds),
        fileKeyColumns: ['file_key'],
      },
      {
        table: 'inspection_item_results',
        label: 'Standalone inspection results',
        category: 'fleet',
        condition: anyUuid('inspection_id', inspectionIds),
      },
      {
        table: 'vehicle_inspections',
        label: 'Standalone vehicle inspections',
        category: 'fleet',
        condition: anyUuid('id', inspectionIds),
      },
      {
        table: 'vehicle_documents',
        label: 'Vehicle documents',
        category: 'fleet',
        condition: anyUuid('vehicle_id', vehicleIds),
        fileKeyColumns: ['file_key'],
      },
      {
        table: 'vehicle_status_events',
        label: 'Vehicle status history',
        category: 'fleet',
        condition: sql`${anyUuid('vehicle_id', vehicleIds)} AND NOT (reference_entity_type IN ('trip','allocation') AND ${anyText('reference_entity_id', operationalEventIds)})`,
      },
      {
        table: 'vehicle_defects',
        label: 'Vehicle defects',
        category: 'fleet',
        condition: sql`${anyUuid('vehicle_id', vehicleIds)} AND ${notAnyUuid('trip_id', operationalIds.tripIds)} AND ${notAnyUuid('inspection_id', operationalIds.inspectionIds)}`,
      },
      {
        table: 'maintenance_events',
        label: 'Maintenance history',
        category: 'fleet',
        condition: anyUuid('vehicle_id', vehicleIds),
        fileKeyColumns: ['document_keys'],
      },
      {
        table: 'vehicle_odometer_events',
        label: 'Vehicle odometer history',
        category: 'fleet',
        condition: sql`${anyUuid('vehicle_id', vehicleIds)} AND ${notAnyUuid('source_entity_id', [...operationalIds.inspectionIds, ...operationalIds.fuelTransactionIds, ...operationalIds.tripIds])}`,
      },
      {
        table: 'vehicles',
        label: 'Vehicles',
        category: 'fleet',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'vehicle_categories',
        label: 'Vehicle categories',
        category: 'fleet',
        condition: sql`tenant_id = ${tenantId}`,
      },
    );
  }

  if (selected.has('people')) {
    const externalPartyIds = await ids(
      db,
      sql`SELECT id FROM external_parties WHERE tenant_id = ${tenantId}`,
    );
    const externalLicenceIds = externalPartyIds.length
      ? await ids(
          db,
          sql`SELECT id FROM external_driver_licences WHERE ${anyUuid('external_party_id', externalPartyIds)}`,
        )
      : [];
    const employeeIds = await ids(db, sql`SELECT id FROM employees WHERE tenant_id = ${tenantId}`);
    const driverProfileIds = employeeIds.length
      ? await ids(
          db,
          sql`SELECT id FROM driver_profiles WHERE ${anyUuid('employee_id', employeeIds)}`,
        )
      : [];
    const licenceIds = driverProfileIds.length
      ? await ids(
          db,
          sql`SELECT id FROM driver_licences WHERE ${anyUuid('driver_profile_id', driverProfileIds)}`,
        )
      : [];
    definitions.push(
      {
        table: 'external_driver_licences',
        label: 'External driver licence versions',
        category: 'people',
        condition: anyUuid('id', externalLicenceIds),
        fileKeyColumns: ['front_image_key', 'back_image_key'],
      },
      {
        table: 'external_parties',
        label: 'External parties',
        category: 'people',
        condition: anyUuid('id', externalPartyIds),
      },
      {
        table: 'secure_request_sessions',
        label: 'Secure staff sessions',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'secure_request_verifications',
        label: 'Secure staff verifications',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'employee_correction_requests',
        label: 'Employee correction requests',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'employee_availability',
        label: 'Employee availability',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
        fileKeyColumns: ['supporting_document_key'],
      },
      {
        table: 'employee_assignments',
        label: 'Employee assignments',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'role_delegations',
        label: 'Role delegations',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
        fileKeyColumns: ['appointment_memo_key'],
      },
      {
        table: 'driver_licence_corrections',
        label: 'Driver licence corrections',
        category: 'people',
        condition: anyUuid('licence_id', licenceIds),
      },
      {
        table: 'driver_licence_codes',
        label: 'Driver licence codes',
        category: 'people',
        condition: anyUuid('licence_id', licenceIds),
      },
      {
        table: 'driver_professional_authorisations',
        label: 'Driver authorisations',
        category: 'people',
        condition: anyUuid('driver_profile_id', driverProfileIds),
      },
      {
        table: 'driver_licences',
        label: 'Driver licences',
        category: 'people',
        condition: anyUuid('id', licenceIds),
        fileKeyColumns: ['document_key', 'front_image_key', 'back_image_key', 'source_pdf_key'],
      },
      {
        table: 'driver_profiles',
        label: 'Driver profiles',
        category: 'people',
        condition: anyUuid('id', driverProfileIds),
      },
      {
        table: 'employee_documents',
        label: 'Employee documents',
        category: 'people',
        condition: anyUuid('employee_id', employeeIds),
        fileKeyColumns: ['file_key'],
      },
      {
        table: 'employees',
        label: 'Employees',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'employee_number_counters',
        label: 'Employee number counter',
        category: 'people',
        condition: sql`tenant_id = ${tenantId}`,
      },
    );
  }

  if (selected.has('organisation')) {
    definitions.push(
      {
        table: 'department_offices',
        label: 'Department-office links',
        category: 'organisation',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'regions',
        label: 'Regions',
        category: 'organisation',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'departments',
        label: 'Departments',
        category: 'organisation',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'offices',
        label: 'Offices',
        category: 'organisation',
        condition: sql`tenant_id = ${tenantId}`,
      },
    );
  }

  if (selected.has('access')) {
    const removedMembershipIds = await ids(
      db,
      ownerUserId
        ? sql`SELECT id FROM tenant_memberships WHERE tenant_id = ${tenantId} AND ${notAnyUuid('id', protectedMembershipIds)}`
        : sql`SELECT id FROM tenant_memberships WHERE tenant_id = ${tenantId} AND FALSE`,
    );
    const removedUserIds = removedMembershipIds.length
      ? (
          await rows(
            db,
            sql`SELECT user_id AS id FROM tenant_memberships WHERE ${anyUuid('id', removedMembershipIds)}`,
          )
        )
          .map((row) => row.id)
          .filter((id): id is string => typeof id === 'string')
      : [];
    const invitationIds = await ids(
      db,
      sql`SELECT id FROM tenant_invitations WHERE tenant_id = ${tenantId}`,
    );
    definitions.push(
      {
        table: 'session',
        label: 'Revoked user sessions',
        category: 'access',
        condition: removedUserIds.length
          ? sql`user_id = ANY(${sql.raw(`ARRAY[${removedUserIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')}]::text[]`)})`
          : sql`FALSE`,
      },
      {
        table: 'invitation_roles',
        label: 'Invitation role assignments',
        category: 'access',
        condition: anyUuid('invitation_id', invitationIds),
      },
      {
        table: 'tenant_invitations',
        label: 'Tenant invitations',
        category: 'access',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'role_assignments',
        label: 'User role assignments',
        category: 'access',
        condition: anyUuid('tenant_membership_id', removedMembershipIds),
      },
      {
        table: 'tenant_memberships',
        label: 'Tenant memberships except protected administrators',
        category: 'access',
        condition: anyUuid('id', removedMembershipIds),
      },
    );
  }

  if (selected.has('configuration')) {
    const definitionIds = await ids(
      db,
      sql`SELECT id FROM workflow_definitions WHERE tenant_id = ${tenantId}`,
    );
    const templateIds = await ids(
      db,
      selected.has('fleet')
        ? sql`SELECT id FROM inspection_templates WHERE tenant_id = ${tenantId}`
        : sql`SELECT template.id FROM inspection_templates template
          WHERE template.tenant_id = ${tenantId}
            AND NOT EXISTS (
              SELECT 1 FROM vehicle_inspections vi
              WHERE vi.template_id = template.id
                AND ${notAnyUuid('vi.id', operationalIds.inspectionIds)}
            )`,
    );
    definitions.push(
      {
        table: 'workflow_steps',
        label: 'Workflow steps',
        category: 'configuration',
        condition: anyUuid('definition_id', definitionIds),
      },
      {
        table: 'workflow_definitions',
        label: 'Workflow definitions',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'inspection_template_items',
        label: 'Inspection template items',
        category: 'configuration',
        condition: anyUuid('template_id', templateIds),
      },
      {
        table: 'inspection_templates',
        label: 'Unreferenced inspection templates',
        category: 'configuration',
        condition: anyUuid('id', templateIds),
      },
      {
        table: 'tenant_holidays',
        label: 'Tenant holidays',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'notification_preferences',
        label: 'Notification preferences',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'request_reference_sequences',
        label: 'Request numbering sequences',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'programme_reference_sequences',
        label: 'Programme numbering sequences',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'trip_authority_sequences',
        label: 'Authority numbering sequence',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'trip_incident_sequences',
        label: 'Incident numbering sequence',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'incident_categories',
        label: 'Incident categories',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'emergency_contacts',
        label: 'Emergency contacts',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'signatory_positions',
        label: 'Signatory positions',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'tenant_readiness_checks',
        label: 'Tenant readiness checks',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
      {
        table: 'tenant_setup_progress',
        label: 'Tenant setup progress',
        category: 'configuration',
        condition: sql`tenant_id = ${tenantId}`,
      },
    );
  }

  return definitions;
}

export async function buildAdvancedResetPlan(input: {
  tenantId: string;
  resetSpec: unknown;
  operationalPlan: ResetPlan;
}): Promise<AdvancedResetPlan> {
  const db = getDb() as unknown as ResetDb;
  const resetSpec = normalizeResetSpec(input.resetSpec, { target: 'tenant' });
  const protectedAccessSet = resetSpec.categories.includes('access')
    ? await protectedAccess(db, input.tenantId)
    : { ownerUserId: null, membershipIds: [] };
  if (resetSpec.categories.includes('access') && !protectedAccessSet.ownerUserId)
    throw new Error('Access reset blocked: no active Tenant Owner can be protected');
  const operationalIds = resetSpec.categories.includes('operations')
    ? input.operationalPlan.ids
    : EMPTY_OPERATIONAL_IDS;
  const unorderedDefinitions = await buildDefinitions(
    db,
    input.tenantId,
    resetSpec,
    operationalIds,
    protectedAccessSet.ownerUserId,
    protectedAccessSet.membershipIds,
  );
  const definitions = await orderByForeignKeys(db, unorderedDefinitions);
  const steps: AdvancedResetStep[] = [];
  const categoryCounts: Partial<Record<ResetCategoryId, number>> = {};
  for (const definition of definitions) {
    const before = await count(db, definition.table, definition.condition);
    steps.push({ ...definition, before });
    categoryCounts[definition.category] = (categoryCounts[definition.category] ?? 0) + before;
  }
  const total = steps.reduce((sum, step) => sum + step.before, 0);
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        tenantId: input.tenantId,
        resetSpec,
        ownerUserId: protectedAccessSet.ownerUserId,
        protectedMembershipIds: protectedAccessSet.membershipIds,
        steps: steps.map((step) => [step.table, step.before]),
      }),
    )
    .digest('hex');
  return {
    tenantId: input.tenantId,
    resetSpec,
    protectedOwnerUserId: protectedAccessSet.ownerUserId,
    protectedMembershipIds: protectedAccessSet.membershipIds,
    steps,
    categoryCounts,
    total,
    fingerprint,
    protected: RESET_ALWAYS_PROTECTED,
  };
}

export async function exportAdvancedResetRows(plan: AdvancedResetPlan) {
  const db = getDb() as unknown as ResetDb;
  const tables: Array<{ table: string; label: string; rows: Array<Record<string, unknown>> }> = [];
  for (const step of plan.steps) {
    if (!step.before) continue;
    const exported = await rows(
      db,
      sql`SELECT * FROM ${sql.raw(quoteTable(step.table))} WHERE ${step.condition}`,
    );
    tables.push({ table: step.table, label: step.label, rows: exported });
  }
  return tables;
}

export async function executeAdvancedResetPlan(plan: AdvancedResetPlan) {
  const db = getDb() as unknown as ResetDb;
  const outcomes: Array<{ table: string; label: string; planned: number; removed: number }> = [];
  for (const step of plan.steps) {
    if (!step.before) continue;
    await db.execute(sql`DELETE FROM ${sql.raw(quoteTable(step.table))} WHERE ${step.condition}`);
    outcomes.push({
      table: step.table,
      label: step.label,
      planned: step.before,
      removed: step.before,
    });
  }
  return outcomes;
}
