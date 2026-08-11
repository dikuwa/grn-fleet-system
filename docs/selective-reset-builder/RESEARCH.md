# Selective Reset Builder Research

## Overview

Extend the existing production-safe tenant and platform operational resets with dependency-aware selective cleanup and clean-slate presets. The current operational behavior remains unchanged.

## Problem Statement

Owners need to remove old operational history or restart master data such as programmes, fleet, staff, access, departments, and offices without deleting the tenant, subscription, recovery history, or audit trail. Raw table selection is unsafe because the domains are connected by foreign keys, files, user identities, and workflow history.

## User Stories / Use Cases

- A Tenant Administrator requests removal of operations older than a cutoff date.
- A Tenant Administrator selects programmes and documents in addition to operations.
- A Tenant Owner requests a clean slate while retaining the tenant shell, subscription, one owner, backups, and audit evidence.
- A Platform Administrator reviews the resolved dependencies and exact impact before approval.
- A Platform Owner applies the same reset specification to one, selected, or all production tenants.
- A future domain registers one reset category without requiring a new UI or workflow.

## Technical Research

### Approach Options

1. Table checkboxes: simple UI but unsafe, schema-coupled, and difficult to restore.
2. Independent reset implementations per domain: initially direct but duplicates preview, backup, approval, execution, and UI behavior.
3. Versioned domain catalog: business categories resolve into ordered table plans with dependencies and protected invariants.

### Recommended Approach

Use a versioned `ResetSpec` and central category catalog. Resolve user selections into a deterministic plan, store the resolved specification with the request, fingerprint the exact entity IDs and counts, archive the same plan, and execute only if the plan is unchanged.

The catalog exposes labels, risk, dependencies, cutoff support, protected records, and availability. The client renders this API contract, so future categories do not require a reset-page rewrite.

### Required Technologies

- Existing Drizzle/PostgreSQL data layer and atomic mutation helper.
- Existing reset request, backup, audit, notification, and confirmation workflows.
- Existing Card, Badge, Dialog, Select, Input, and theme-token components.

### Data Requirements

- Versioned reset specification in reset-request metadata for backward compatibility.
- Resolved category list and dependency reasons.
- Optional UTC cutoff for eligible operational roots.
- Exact counts, storage keys, protected invariants, fingerprint, and catalog version.
- Backup metadata containing the reset specification and plan version.

## UI/UX Considerations

- Three preset cards: Operational, Selective cleanup, Clean slate.
- Business-domain category cards rather than database table names.
- Automatically included dependencies are visible and cannot be silently removed.
- Amber treatment for selective cleanup, red for clean slate, green for protected data.
- Exact quoted confirmation phrase in the existing destructive color token.
- All styling uses existing semantic theme tokens and remains usable in light/dark themes.

## Integration Points

- `src/lib/data-reset/config.ts` and `plan.ts`: current ordered operational registry.
- `src/lib/data-protection/reset-service.ts`: preview, fingerprint, execution, integrity.
- `src/lib/data-protection/backup-service.ts`: verified recovery point.
- Tenant Admin and Platform Admin reset APIs/pages.
- Existing reset-request scope enum already contains operational, fleet, user_access, and full scopes.

## Risks and Challenges

- Master data dependencies must be removed only after operational roots.
- Global auth users may belong to multiple tenants; remove tenant access, not the global account.
- The final tenant/platform owner, subscription, billing, audit, backup, and reset history must never be selectable.
- Old-data cleanup must select complete request trees from the root cutoff.
- Multi-tenant platform batches should be isolated per tenant rather than one cross-tenant transaction.

## Open Questions

No blocking product questions. Conservative defaults are used: active data is included only in all-data/clean-slate plans, global auth accounts are preserved, and audit/commercial records are immutable to this feature.

## References

- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- NIST audit information protection: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/800-171r3/NIST.SP.800-171r3.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
