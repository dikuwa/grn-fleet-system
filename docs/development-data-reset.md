# Development Data Reset

A safe, tenant-aware, reversible-by-design cleanup process for **development and
staging** databases. It removes old seed/demo/operational workflow records so
the full transport lifecycle can be tested from a clean state, while preserving
users, roles, staff, tenants, configuration, vehicles and reference data.

> ⚠️ **This tool is blocked in production.** It refuses to run unless
> `ALLOW_DEV_DATA_RESET=true` is explicitly set, the target database is not a
> production database, and the exact confirmation phrase is supplied. When in
> doubt, run the dry-run first.

---

## 1. Safety model

| Rule | Implementation |
| --- | --- |
| Production block | `NODE_ENV=production`, `VERCEL_ENV=production`, a `*.prod` / production-marker host, or a configured production safety flag → hard stop. |
| Explicit opt-in | `ALLOW_DEV_DATA_RESET=true` required. |
| Confirmation phrase | `RESET GRN FLEET DEVELOPMENT DATA` required for every execution. |
| Dry-run first | `data-reset:*:dry-run` never mutates anything. |
| Backup before delete | Affected rows are exported to timestamped JSON under `.data-reset-backups/` before any delete. |
| Transaction / staging | Uses `db.transaction()` when the driver supports it (local Postgres). On Neon (HTTP driver, no transactions) it runs a safe staged sequence and never deletes storage until DB changes succeed. |
| Tenant boundary | Every delete is scoped to a tenant id; omitting `--tenant` aborts. |
| Audit record | Every execution writes a reset audit record (mode, tenant, environment, counts, backup path, result). |

**What is preserved** (never touched by the operational reset):

- users, user profiles, sessions, accounts, MFA, tenant memberships
- roles, permissions, role assignments, delegations, route access
- employees/staff, driver profiles, verified licences, licence documents
- tenants, branding, offices, departments, regions, municipalities
- vehicles and vehicle master records (default mode)
- vehicle categories, fuel types, request/trip types, lookup data
- workflow definitions/steps, approval routing, document templates,
  notification templates, inspection templates and checklist items
- programmes configuration, numbering/sequence configuration
- audit events for auth, user creation, role changes, security, admin actions

**What is removed** (operational reset, Mode A):

- transport requests and all children (passengers, destinations, activities,
  attachments, comments, approvals, audit events, sharing, revisions)
- trips, allocations, trip authorities, passengers, assigned drivers, routes,
  schedules, status history, QR records
- vehicle inspections, responses, photos, defects, signatures
- driver logsheets, odometer events (raised by removed trips, inspections or
  fuel entries), fuel entries, receipts, OCR results, trip remarks, offline
  drafts, breakdown/accident records
- generated documents and share links tied to removed entities
- notifications caused by removed operational entities
- workflow instances tied to removed requests
- transaction attachments / storage keys collected from the removed rows

**Requires review** (counted, never auto-deleted): maintenance events,
vehicle documents, programmes, import batches, tenant holidays.

---

## 2. Commands

All commands require `pnpm` (or `npm run`) and the env vars below.

```bash
# Mode A — operational reset (recommended)
pnpm data-reset:operational:dry-run --tenant=<tenant-id>
pnpm data-reset:operational:execute --tenant=<tenant-id>

# Mode B — demo-account review (lists only)
pnpm data-reset:demo-accounts:dry-run --tenant=<tenant-id>

# Mode B — delete only explicitly approved demo accounts
pnpm data-reset:demo-accounts:execute --tenant=<tenant-id> --ids=<id1,id2,...>

# Mode C — demo-vehicle review (explicit demo licence prefixes only)
pnpm data-reset:demo-vehicles:dry-run --tenant=<tenant-id>
pnpm data-reset:demo-vehicles:execute --tenant=<tenant-id> --ids=<id1,id2,...>
```

> **Mode C requires `--ids` from the dry-run.** Omitting it makes the CLI
> target every listed demo vehicle, which fails the whole run whenever any of
> them still has operational records (trips, allocations, odometer events,
> defects) — the guard is all-or-nothing by design. Vehicles with only fuel
> transactions or inspections are safe to delete: those child records are
> removed with the vehicle.

### Environment

```env
# Required for every mode — including dry-run (the guard refuses to run
# without it; never set it in production)
ALLOW_DEV_DATA_RESET=true

# Required confirmation phrase passed to execute commands
# (passed as --confirm="RESET GRN FLEET DEVELOPMENT DATA")
DATABASE_URL=postgres://...            # already configured in the app
```

### Options

| Option | Applies to | Meaning |
| --- | --- | --- |
| `--tenant=<uuid>` | all | Tenant scope. **Required.** |
| `--confirm="RESET GRN FLEET DEVELOPMENT DATA"` | all execute | Confirmation phrase. |
| `--ids=<id1,id2>` | demo-accounts / demo-vehicles execute | Explicitly approved demo account / vehicle ids (from the dry-run). |

---

## 3. Example session

```bash
# 1. Dry run — read only
pnpm data-reset:operational:dry-run --tenant=00000000-0000-0000-0000-000000000001

# 2. Execute — requires flag + phrase
ALLOW_DEV_DATA_RESET=true \
pnpm data-reset:operational:execute \
  --tenant=00000000-0000-0000-0000-000000000001 \
  --confirm="RESET GRN FLEET DEVELOPMENT DATA"

# 3. Verify the dashboard reflects the clean state, then add baseline data
pnpm seed:minimal-test-data
```

---

## 4. Minimal test-data baseline

`pnpm seed:minimal-test-data` creates (idempotently) a small intentional
baseline so the full workflow can be exercised end to end:

- the tenant (if missing), branding, offices, departments
- permissions, system roles, role → permission mappings
- 10 staff records (requester, supervisor, CAO, DD, director, CRO,
  transport admin, drivers …) keyed by employee number
- driver profiles + verified licences for drivers
- vehicle categories and 4 test vehicles
- the regional workflow definition and its steps
- departure/return inspection templates with their checklist items
- login accounts (`admin@kavangoeast.gov.na`, `*.test` accounts) with the
  shared password `changeme` (override via `SEED_ADMIN_PASSWORD`)
- one published baseline programme

It **never** creates requests, trips, documents, notifications, expenses,
inspections or maintenance events — those are created manually through the UI
so you can observe the full lifecycle from a clean state.

It is also non-destructive to existing data: default permissions are only
added to roles the script itself creates (never clobbering custom role
permissions), and existing staff records keyed by employee number are never
overwritten.

> After the reset, the preserved tenant administrator can log in at
> `admin@kavangoeast.gov.na` (or `SEED_ADMIN_EMAIL`).

---

## 5. Demo account & demo vehicle review

### Mode B — demo accounts

`data-reset:demo-accounts:dry-run` lists user accounts matching seed markers
(seed-prefixed user ids, `*.test` emails, known demo emails) and classifies
each as **proposed for deletion** (no roles, no staff link, no tenant
membership) or **preserved** (any role/staff/tenant relationship).

`data-reset:demo-accounts:execute` deletes **only** accounts that are both in
the proposed set and explicitly listed via `--ids` (copied from the dry-run
output). Anything else — including any id with a role, staff link, or tenant
membership — is blocked and reported. A JSON backup of the proposed accounts
is written to `.data-reset-backups/demo-accounts/<timestamp>/` first, and an
audit event is recorded.

### Mode C — demo vehicles

Only vehicles whose licence number starts with the configured demo prefix
(`E2E-*` — see `DEMO_VEHICLE_LICENCE_PREFIXES` in `src/lib/data-reset/config.ts`)
are listed. The execute mode refuses to delete any vehicle that still has
operational records (trips, allocations, odometer events, defects) — run the
operational reset first.

Notifications referencing the deleted vehicles' fuel transactions and
inspections are removed along with those children (they are loose polymorphic
rows with no FK), so Mode C never leaves orphaned notifications behind.

---

## 6. Backups

Executions export the exact rows scheduled for deletion to
`.data-reset-backups/<mode>/<timestamp>/…json` (one file per table) before
deleting anything. The backup directory is git-ignored.

```text
.data-reset-backups/
  operational/
    2026-08-04T12-00-00Z/
      transport_requests.json
      trips.json
      ...
      manifest.json          # environment, tenant, counts, timestamps
```

To restore, re-insert the exported rows (or restore a database-level backup
taken before the reset).

---

## 7. Integrity checks

After a reset, the engine runs an integrity pass and reports any:

- role assignments referencing missing users/memberships
- employees referencing missing offices/departments
- driver profiles referencing missing staff
- licences referencing missing driver profiles
- requests referencing missing users
- documents/notifications referencing removed entities
- duplicate employee numbers, licence numbers, vehicle registrations
- stale generated documents left pointing at removed entities

A critical failure marks the reset **failed** and the CLI exits non-zero so CI
or a human can investigate.

---

## 8. Reports

Every dry-run and execution prints a report with sections:

```
Tenant name / Tenant ID / Environment / Database
Preserved (per category, with counts)
Scheduled for Removal (per step, with before counts)
Requires Review (counted, not deleted)
Storage objects to be removed / skipped
Integrity check results
Backup location (executions)
Reset audit record id (executions)
```

The full machine-readable plan and audit data are also written under
`.data-reset-backups/<mode>/<timestamp>/`.

---

## 9. Production protection

The guard aborts when **any** of these is true:

- `NODE_ENV === 'production'`
- `VERCEL_ENV === 'production'` (and other PaaS production signals)
- the resolved database host carries a production marker (a `prod` host label
  such as `ep-….prod.aws.neon.tech`, or `-prod-` in the hostname) — hard block
- `ALLOW_DEV_DATA_RESET !== 'true'` (all modes, including dry-run)

Other non-local hosts (e.g. a shared staging database) only produce a warning
so you can still run against an explicitly chosen staging environment.

If you deploy to Vercel, ensure `ALLOW_DEV_DATA_RESET` is **not** set in the
production environment and that production `DATABASE_URL` points to a
non-`prod`-marked branch.

---

## 10. Implementation notes

| File | Purpose |
| --- | --- |
| `src/lib/data-reset/config.ts` | Table registry, delete-step order, preserved/review tables, quote helper |
| `src/lib/data-reset/guard.ts` | Environment/flag/phrase/tenant validation |
| `src/lib/data-reset/plan.ts` | Tenant-scoped plan builder + id-set collection (single source of truth for dry-run and execute) |
| `src/lib/data-reset/backup.ts` | JSON row export before deletion |
| `src/lib/data-reset/engine.ts` | Orchestrator (dry-run/execute, transaction-or-staged deletes, storage cleanup, integrity, audit) |
| `src/lib/data-reset/integrity.ts` | Post-reset orphan/consistency checks |
| `src/lib/data-reset/report.ts` | Report + reset audit record rendering |
| `src/lib/data-reset/demo.ts` | Demo-account review + demo-vehicle modes |
| `src/scripts/data-reset-cli.ts` | CLI entry point |
| `src/seed/seed-minimal-test-data.ts` | Idempotent minimal baseline |

The engine uses raw, parameterized SQL through `db.execute` (works on both the
local postgres.js driver and the Neon HTTP driver) so it is driver-agnostic.
