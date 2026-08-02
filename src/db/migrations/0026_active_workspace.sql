-- Persist the most recent valid workspace per tenant membership. Eligibility is
-- always recalculated from active role assignments before this value is used.
ALTER TABLE "tenant_memberships"
  ADD COLUMN IF NOT EXISTS "active_workspace" text;

CREATE INDEX IF NOT EXISTS "tenant_memberships_user_tenant_workspace_idx"
  ON "tenant_memberships" ("user_id", "tenant_id", "active_workspace");
