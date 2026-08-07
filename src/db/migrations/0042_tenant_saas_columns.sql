-- 0042_tenant_saas_columns.sql
-- Add the SaaS tenant columns declared in src/db/schema/tenants.ts that were
-- never migrated onto the `tenants` table.
--
-- Background:
--   Migration 0033 created the SaaS platform tables (subscriptions, packages,
--   invitations, demo sandboxes, CMS, ...) but never ALTERed `tenants` to add
--   the onboarding/contact columns the drizzle schema declares. Drizzle emits
--   explicit column lists for every select(), so ANY `SELECT ... FROM tenants`
--   (run by getTenantEntitlements() on every session resolution) failed with
--   `column "created_by_user_id" does not exist`. That error was swallowed by
--   resolveUserTenant()'s catch block, so every tenant API returned 401 while
--   login itself succeeded.
--
--   This migration adds the missing columns. All ALTERs use IF NOT EXISTS and
--   nullable/defaulted types, so the migration is idempotent and safe to
--   re-run in production via the build-time prebuild hook.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS primary_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS primary_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS primary_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_onboarding_step INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_reason TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at TIMESTAMPTZ;
