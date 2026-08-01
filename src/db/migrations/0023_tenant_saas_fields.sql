-- 0023_tenant_saas_fields.sql
-- SaaS-ready tenant lifecycle and entitlement fields.
-- status is normalised to ACTIVE/SUSPENDED/TRIAL/ARCHIVED; legacy rows are migrated.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "plan_code" text NOT NULL DEFAULT 'INTERNAL_DEFAULT';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_status" text NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp(3) with time zone;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "vehicle_limit" integer;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "user_limit" integer;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "storage_limit" integer;

-- Normalise legacy status values to the SaaS vocabulary.
-- NOTE: legacy 'inactive' maps to ARCHIVED (not ACTIVE) so a deactivated
-- tenant can never silently regain access.
UPDATE "tenants" SET "status" = 'ACTIVE' WHERE lower("status") IN ('active', '');
UPDATE "tenants" SET "status" = 'SUSPENDED' WHERE lower("status") = 'suspended';
UPDATE "tenants" SET "status" = 'TRIAL' WHERE lower("status") = 'trial';
UPDATE "tenants" SET "status" = 'ARCHIVED' WHERE lower("status") IN ('archived', 'inactive');
UPDATE "tenants" SET "status" = 'ACTIVE' WHERE "status" IS NULL;
