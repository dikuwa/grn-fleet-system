-- Stage 1 of the notification dedupe rollout.
--
-- The currently deployed application may still issue ON CONFLICT (dedupe_key),
-- so the legacy global unique index must remain until this compatibility code
-- has been deployed successfully. Pre-create the tenant-scoped unique index now;
-- a follow-up migration will drop notifications_dedupe_key_idx only after all
-- live writers no longer depend on that explicit conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_tenant_dedupe_key_idx
ON notifications (tenant_id, dedupe_key);
