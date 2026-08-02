# Organisation, Staff Import and Driver Integration Audit — 2026-08-02

## Existing implementation retained

- Tenant-aware office, department, employee and driver tables.
- Existing Organisation Structure route, tabs, shared dialogs, buttons, toast system and mobile card layouts.
- Existing Staff Directory, Employee Detail, Driver Administration and Driver Detail routes.
- Shared employee identity with a one-to-one driver profile and historical licence records.
- Existing role/permission checks, lifecycle assignments, import batches/rows and tenant audit events.
- Unified CSV/XLSX browser parser and the established 14-column CSV template.

## Gaps found

- Employee creation and import required a supplied number; the import duplicate lookups were not tenant-scoped.
- Import committed rows independently, silently updated matching employees and could leave partial results.
- The import UI exposed only 10 columns and incorrectly required `employee_number`.
- Imported drivers could not be represented safely as incomplete pending licence capture.
- Staff creation option queries were not scoped to the active tenant.
- Office/department codes lacked server-side tenant uniqueness and hierarchy validation.
- “Directorate” was incorrectly available as an office type.
- Departments had no type, parent or explicit many-to-many office relationship.
- Detail API routes duplicated update logic and could bypass collection-route validation.
- Referenced office/department deletion did not distinguish archival from safe permanent deletion.
- Driver reactivation did not require a current verified licence.

## Integration completed

- Added a transactional per-tenant employee-number counter with tenant code/configured-prefix support and collision skipping.
- Added tenant-scoped database uniqueness for employee numbers, office codes and organisation-unit codes.
- Added organisation-unit type/hierarchy, archive timestamps and explicit department-office links.
- Backfilled department-office links from current employee assignments in the migration.
- Added server-side tenant ownership checks, circular hierarchy prevention, code normalisation and audit entries.
- Added safe archive-versus-delete handling based on live and historical references.
- Added editable automatic code suggestions that stop regenerating after manual edits.
- Reworked staff import as an all-or-nothing transaction with row-level validation, duplicate detection, tenant-only lookup, canonical field support, Boolean/status normalisation, assignment history, import rows and audit summary.
- Blank employee numbers are generated; supplied numbers and leading zeros are preserved as strings.
- Driver rows create one linked incomplete/unavailable profile and never invent licence data.
- Driver authorisation/reactivation requires a current verified licence.
- Restored the canonical header-only CSV download, download error toast and manual column remapping.
- Added reviewed organisation-value resolution: normalised auto-match, map existing, explicitly create, leave unassigned or skip affected rows.
- Expanded the staff form with optional employee number, organisation fields, operational status/availability and safe driver conversion.
- Expanded Kavango East-only idempotent seed master data without deleting legacy referenced offices or organisation units.

## Verification

- `npm run typecheck` — passed.
- Targeted ESLint on all modified TypeScript/TSX files — passed.
- Focused organisation-code, template and cross-tenant tests — 22 passed; the environment-dependent security test reports the expected missing `DATABASE_URL` warning.
- `npm run build` — production build passed, including static generation of 134 pages.
- Migration 0029 was applied to the configured Neon database and verified through Drizzle tracking, schema columns, indexes, relationship backfill and tenant counter checks. Live browser acceptance testing remains a deployment-environment step.
