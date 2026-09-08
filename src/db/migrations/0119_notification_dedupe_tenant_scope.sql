-- Notification dedupe keys are tenant-local idempotency tokens. Replace the
-- legacy global uniqueness boundary without exposing a live-write window where
-- same-tenant duplicates can be inserted between index changes.
LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;

DROP INDEX IF EXISTS notifications_dedupe_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_tenant_dedupe_key_idx
ON notifications (tenant_id, dedupe_key);
