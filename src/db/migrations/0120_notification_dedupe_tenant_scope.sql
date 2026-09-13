-- 0120_notification_dedupe_tenant_scope.sql
-- Stage 3 of the notification dedupe rollout.
--
-- Preconditions:
--   1. Public/API notification writes no longer persist caller-provided dedupe keys.
--   2. Historical non-NULL keys have been quarantined by migration 0119.
--
-- Swap the legacy global uniqueness boundary for tenant-local uniqueness while
-- blocking concurrent notification writes for the short index replacement.

LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;

DROP INDEX IF EXISTS notifications_dedupe_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_tenant_dedupe_key_idx
ON notifications (tenant_id, dedupe_key)
WHERE dedupe_key IS NOT NULL;
