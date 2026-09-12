-- Stage 2 of notification dedupe tenant isolation.
-- This migration must only be deployed after the compatibility release that
-- removes explicit ON CONFLICT (dedupe_key) targets is confirmed live.
LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;

DROP INDEX IF EXISTS notifications_dedupe_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_tenant_dedupe_key_idx
ON notifications (tenant_id, dedupe_key)
WHERE dedupe_key IS NOT NULL;
