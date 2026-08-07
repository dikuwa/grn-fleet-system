-- 0041_tenant_lifecycle_backfill.sql
-- Add the SaaS onboarding lifecycle column declared in src/db/schema/tenants.ts
-- (lifecycleStatus) which was never migrated, then backfill existing tenants
-- from their legacy `status` column.
--
-- Rationale:
--   * canTenantOperate() (src/lib/entitlements.ts) blocks any tenant whose
--     lifecycle_status is DRAFT/PENDING_*/READY_FOR_ACTIVATION/etc. The column
--     default is 'DRAFT', so without a backfill every pre-existing tenant
--     would silently lose session access after the column is added.
--   * New tenants created through the platform onboarding flow set an explicit
--     lifecycleStatus, so the column default stays 'DRAFT' for that path.
--   * The UPDATE only touches rows that are still 'DRAFT' immediately after the
--     column is added (i.e. every pre-existing row) and maps them from the
--     legacy status. It is a no-op on rows already set by a later re-run.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT';

UPDATE tenants
SET lifecycle_status = CASE
  WHEN UPPER(status) IN ('ACTIVE', 'TRIAL')       THEN 'ACTIVE'
  WHEN UPPER(status) = 'ARCHIVED'                 THEN 'ARCHIVED'
  WHEN UPPER(status) = 'SUSPENDED'                THEN 'SUSPENDED'
  WHEN UPPER(status) = 'RESTRICTED'               THEN 'RESTRICTED'
  -- Unknown/unexpected legacy statuses stay DRAFT (blocked from login)
  -- so they can be reviewed and activated through the platform flow.
  ELSE 'DRAFT'
END
WHERE lifecycle_status = 'DRAFT';

CREATE INDEX IF NOT EXISTS tenants_lifecycle_status_idx
  ON tenants (lifecycle_status);
