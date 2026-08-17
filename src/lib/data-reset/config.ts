/**
 * Development Data Reset — configuration
 *
 * Central configuration for the controlled, tenant-aware development data
 * reset. It defines:
 *
 *  - the environment flag and confirmation phrase required before anything
 *    destructive can run;
 *  - the known development seed identifiers (tenant, users, demo emails);
 *  - the ordered, metadata-driven registry of operational tables that the
 *    reset is allowed to touch, together with the column used to scope each
 *    delete to the selected tenant's records.
 *
 * This module is intentionally free of any database or environment side
 * effects so it can be unit-tested in isolation.
 */

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Environment variable that must be explicitly `true` before a reset runs. */
export const DATA_RESET_ENV_FLAG = 'ALLOW_DEV_DATA_RESET';

/** Exact phrase that must be supplied to authorise an executable reset. */
export const DATA_RESET_CONFIRMATION_PHRASE = 'RESET GRN FLEET DEVELOPMENT DATA';

/** Execution modes supported by the reset tool. */
export type ResetMode = 'operational' | 'demo-accounts' | 'demo-vehicles';

export const RESET_MODES: ResetMode[] = ['operational', 'demo-accounts', 'demo-vehicles'];

// ---------------------------------------------------------------------------
// Known development seed identifiers
// ---------------------------------------------------------------------------

/** Primary development seed tenant (Kavango East Regional Council). */
export const SEED_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** Secondary isolation-fixture tenant (Zambezi Regional Council). */
export const ISOLATION_TENANT_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Better Auth user IDs created by the development seed use the
 * `user-seed-<role-key>` prefix. Used to propose demo accounts for review.
 */
export const SEED_USER_ID_PREFIX = 'user-seed-';

/**
 * Emails used only by development seed accounts. `@kavangoeast.test`,
 * `@grnfleet.test` and the `.test` TLD are reserved for testing; the
 * `admin@kavangoeast.gov.na` account (a real-looking address) is treated as
 * seed too but only ever listed for review — never auto-deleted.
 */
export const SEED_EMAIL_SUFFIXES = ['@kavangoeast.test', '@grnfleet.test'];

/** Known development seed admin email (listed for review only). */
export const SEED_ADMIN_EMAILS = ['admin@kavangoeast.gov.na'];

/** Vehicle licence-number prefixes created by the E2E seed. */
export const DEMO_VEHICLE_LICENCE_PREFIXES = ['E2E-'];

/** Reference prefixes used by the operational data seeds. */
export const SEED_OPERATIONAL_REF_PREFIXES = ['GRN/TR/', 'GRN/RR/'];

// ---------------------------------------------------------------------------
// Operational table registry
// ---------------------------------------------------------------------------

/**
 * Scope used to target a delete at the selected tenant's records.
 *
 *  - `request`            — rows scoped by `request_id IN (tenant request ids)`
 *  - `trip`               — rows scoped by `trip_id IN (tenant trip ids)`
 *  - `allocation`         — rows scoped by `allocation_id IN (tenant allocation ids)`
 *  - `authority`          — rows scoped by `authority_id IN (tenant authority ids)`
 *  - `inspection`         — rows scoped by `inspection_id IN (tenant inspection ids)`
 *  - `fuel`               — rows scoped by `transaction_id IN (tenant fuel ids)`
 *  - `workflowInstance`   — rows scoped by `instance_id IN (tenant workflow instance ids)`
 *  - `document`           — rows scoped by `document_id IN (removed generated document ids)`
 *  - `notification`       — rows scoped by `tenant_id AND entity_id IN (removed entity ids)`
 *  - `tenant`             — rows scoped by `tenant_id = selected tenant`
 */
export type DeleteScope =
  | 'request'
  | 'trip'
  | 'allocation'
  | 'authority'
  | 'inspection'
  | 'fuel'
  | 'workflowInstance'
  | 'document'
  | 'notification'
  | 'tenant';

export interface DeleteStep {
  /** SQL table name (snake_case, matches the Drizzle schema). */
  table: string;
  /** Human-readable domain used in reports. */
  label: string;
  /** How the delete is scoped to the selected tenant. */
  scope: DeleteScope;
  /** Storage key columns collected from the deleted rows for R2 cleanup. */
  fileKeyColumns?: string[];
}

/**
 * Deletion order — children before parents, matching the actual foreign-key
 * graph in src/db/schema. This order is derived from the schema (verified
 * against every `.references()` in the schema files) and must be updated if
 * the schema changes.
 */
export const OPERATIONAL_DELETE_STEPS: DeleteStep[] = [
  // Share links + access events (children of generated documents)
  { table: 'share_links', label: 'Share links', scope: 'document' },
  // Generated documents (request/trip/inspection/fuel reports)
  {
    table: 'generated_documents',
    label: 'Generated documents',
    scope: 'request', // entity-scoped: entity_id in removed entity sets (handled in plan)
    fileKeyColumns: ['file_key'],
  },
  // Transport request children
  {
    table: 'request_attachments',
    label: 'Request attachments',
    scope: 'request',
    fileKeyColumns: ['file_key'],
  },
  { table: 'request_goods_equipment', label: 'Request goods and equipment', scope: 'request' },
  { table: 'external_request_drivers', label: 'External driver nominations', scope: 'request' },
  { table: 'request_routes', label: 'Request routes', scope: 'request' },
  { table: 'request_drivers', label: 'Request drivers', scope: 'request' },
  { table: 'request_passengers', label: 'Request passengers', scope: 'request' },
  { table: 'request_activities', label: 'Request activities', scope: 'request' },
  { table: 'request_revisions', label: 'Request revisions', scope: 'request' },
  // Workflow children (instances are scoped to requests)
  { table: 'workflow_actions', label: 'Workflow actions', scope: 'workflowInstance' },
  { table: 'emergency_overrides', label: 'Emergency overrides', scope: 'workflowInstance' },
  { table: 'workflow_instances', label: 'Workflow instances', scope: 'request' },
  // Trip authority children
  { table: 'trip_authority_versions', label: 'Authority versions', scope: 'authority' },
  { table: 'trip_authority_passengers', label: 'Authority passengers', scope: 'authority' },
  { table: 'trip_authorised_drivers', label: 'Authorised drivers', scope: 'authority' },
  { table: 'trip_amendments', label: 'Trip amendments', scope: 'authority' },
  // Authorities reference allocations + requests, so delete before both
  { table: 'trip_authorities', label: 'Trip authorities', scope: 'request' },
  // Allocation children
  { table: 'external_driver_assignments', label: 'External driver assignments', scope: 'request' },
  { table: 'trip_issues', label: 'Vehicle issues', scope: 'allocation' },
  // Trip children
  { table: 'trip_progress_entries', label: 'Trip progress entries', scope: 'trip' },
  {
    table: 'trip_log_entries',
    label: 'Driver logsheets',
    scope: 'trip',
  },
  { table: 'trip_closures', label: 'Trip closures', scope: 'trip' },
  {
    table: 'trip_expenses',
    label: 'Trip expenses',
    scope: 'trip',
    fileKeyColumns: ['receipt_key'],
  },
  {
    table: 'trip_incidents',
    label: 'Trip incidents',
    scope: 'trip',
    fileKeyColumns: ['attachment_keys'],
  },
  // Fuel children
  { table: 'reimbursements', label: 'Reimbursements', scope: 'fuel' },
  {
    table: 'fuel_receipts',
    label: 'Fuel receipts',
    scope: 'fuel',
    fileKeyColumns: ['file_key'],
  },
  { table: 'fuel_transactions', label: 'Fuel transactions', scope: 'trip' },
  // Inspection children
  {
    table: 'inspection_photos',
    label: 'Inspection photos',
    scope: 'inspection',
    fileKeyColumns: ['file_key'],
  },
  { table: 'inspection_item_results', label: 'Inspection item results', scope: 'inspection' },
  { table: 'vehicle_inspections', label: 'Vehicle inspections', scope: 'trip' },
  // Derived vehicle events linked only to removed operations
  { table: 'vehicle_odometer_events', label: 'Linked odometer events', scope: 'inspection' },
  { table: 'vehicle_status_events', label: 'Linked status events', scope: 'trip' },
  // Trip defects caused by removed trips/inspections
  { table: 'vehicle_defects', label: 'Trip defects', scope: 'trip' },
  // Core operational rows — trips carry an allocation_id FK to
  // vehicle_allocations, so allocations must be deleted AFTER trips.
  { table: 'trips', label: 'Trips', scope: 'request' },
  { table: 'vehicle_allocations', label: 'Vehicle allocations', scope: 'request' },
  { table: 'transport_requests', label: 'Transport requests', scope: 'tenant' },
  // Notifications caused only by removed operations
  { table: 'notification_deliveries', label: 'Notification deliveries', scope: 'notification' },
  { table: 'notification_reads', label: 'Notification reads', scope: 'notification' },
  { table: 'notification_dismissals', label: 'Notification dismissals', scope: 'notification' },
  { table: 'notifications', label: 'Operational notifications', scope: 'notification' },
];

/**
 * Tables that are intentionally never deleted by the default operational
 * reset but may contain test records — reported under "Requires review".
 */
export const REVIEW_ONLY_TABLES: Array<{ table: string; label: string; reason: string }> = [
  {
    table: 'maintenance_events',
    label: 'Maintenance events',
    reason: 'No reliable seed marker; may be legitimate service history.',
  },
  {
    table: 'import_batches',
    label: 'Import batches',
    reason: 'Operational history; preserving avoids ambiguity with real imports.',
  },
  {
    table: 'programmes',
    label: 'Programmes',
    reason: 'Preserved as configuration/reference data; seeded ones flagged for review.',
  },
  {
    table: 'vehicle_documents',
    label: 'Vehicle documents',
    reason: 'Vehicle master reference data.',
  },
  { table: 'tenant_holidays', label: 'Tenant holidays', reason: 'Configuration data.' },
];

/**
 * Tables that the reset always preserves. Kept here for the report so the
 * dry-run output can show what was explicitly protected.
 */
export const PRESERVED_TABLES: Array<{ table: string; label: string }> = [
  { table: 'tenants', label: 'Tenants' },
  { table: 'tenant_branding', label: 'Tenant branding' },
  { table: 'tenant_memberships', label: 'Tenant memberships' },
  { table: 'roles', label: 'Roles' },
  { table: 'permissions', label: 'Permissions' },
  { table: 'role_permissions', label: 'Role permissions' },
  { table: 'role_assignments', label: 'Role assignments' },
  { table: 'user', label: 'Auth users' },
  { table: 'session', label: 'Auth sessions' },
  { table: 'account', label: 'Auth accounts' },
  { table: 'verification', label: 'Auth verifications' },
  { table: 'user_profiles', label: 'User profiles' },
  { table: 'offices', label: 'Offices' },
  { table: 'departments', label: 'Departments' },
  { table: 'department_offices', label: 'Department-office links' },
  { table: 'employee_number_counters', label: 'Employee number counters' },
  { table: 'employees', label: 'Staff' },
  { table: 'employee_documents', label: 'Staff documents' },
  { table: 'driver_profiles', label: 'Driver profiles' },
  { table: 'driver_licences', label: 'Driver licences' },
  { table: 'driver_licence_codes', label: 'Licence codes' },
  { table: 'driver_professional_authorisations', label: 'Professional authorisations' },
  { table: 'driver_licence_corrections', label: 'Licence corrections' },
  { table: 'employee_assignments', label: 'Employee assignments' },
  { table: 'employee_availability', label: 'Employee availability' },
  { table: 'role_delegations', label: 'Role delegations' },
  { table: 'signatory_positions', label: 'Signatory positions' },
  { table: 'employee_correction_requests', label: 'Employee correction requests' },
  { table: 'secure_request_verifications', label: 'Secure request verifications' },
  { table: 'secure_request_sessions', label: 'Secure request sessions' },
  { table: 'vehicle_categories', label: 'Vehicle categories' },
  { table: 'vehicles', label: 'Vehicles' },
  { table: 'regions', label: 'Regions' },
  { table: 'programmes', label: 'Programmes' },
  { table: 'workflow_definitions', label: 'Workflow definitions' },
  { table: 'workflow_steps', label: 'Workflow steps' },
  { table: 'inspection_templates', label: 'Inspection templates' },
  { table: 'inspection_template_items', label: 'Inspection template items' },
  { table: 'trip_authority_sequences', label: 'Trip authority sequences' },
  { table: 'trip_incident_sequences', label: 'Trip incident sequences' },
  { table: 'notification_preferences', label: 'Notification preferences' },
  { table: 'audit_events', label: 'Audit events' },
];

/**
 * Quote a table name for raw SQL (protects reserved words such as `user`).
 */
export function quoteTable(table: string): string {
  return `"${table}"`;
}

/**
 * Build a Postgres `uuid[]` array literal for `= ANY(...)` conditions.
 *
 * Drizzle's `sql` template expands a JavaScript array into separate bound
 * parameters (`($1, $2, …)`), which Postgres interprets as a row constructor
 * and rejects with `cannot cast type record to uuid[]` when combined with a
 * `::uuid[]` cast. Inlining the literal via `sql.raw()` avoids parameter
 * binding entirely and behaves identically on the neon-http and postgres.js
 * drivers.
 */
export function uuidArrayLiteral(ids: string[]): string {
  return arrayLiteral(ids, 'uuid');
}

/**
 * Variant for columns that store ids as `text` (e.g. `reference_entity_id` on
 * `vehicle_status_events`). Comparing a text column against a `uuid[]` array
 * fails with `operator does not exist: text = uuid`, so the literal must be
 * cast to `text[]` instead.
 */
export function textArrayLiteral(ids: string[]): string {
  return arrayLiteral(ids, 'text');
}

function arrayLiteral(ids: string[], type: 'uuid' | 'text'): string {
  const quoted = ids.map((id) => `'${String(id).replace(/'/g, "''")}'`);
  return `ARRAY[${quoted.join(',')}]::${type}[]`;
}

// ---------------------------------------------------------------------------
// File layout
// ---------------------------------------------------------------------------

/** Where timestamped backups of deleted rows are written. */
export const BACKUP_DIR = 'data-reset-backups';

/** Where reset reports (JSON + markdown) are written. */
export const REPORT_DIR = 'data-reset-reports';
