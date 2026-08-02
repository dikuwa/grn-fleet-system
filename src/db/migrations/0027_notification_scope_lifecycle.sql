-- Recipient-specific notification identity and lifecycle. Shared tenant events
-- remain preserved as activity evidence but no longer flood personal feeds.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "event_type" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "workspace" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "workflow_stage" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "event_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupe_key" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'unread';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "mandatory" boolean NOT NULL DEFAULT false;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

UPDATE "notifications"
SET
  "status" = 'archived',
  "archived_at" = COALESCE("archived_at", now()),
  "audience" = 'activity'
WHERE "audience" IN ('tenant', 'role', 'department', 'office', 'tenant_admin');

UPDATE "notifications"
SET "event_type" = COALESCE("event_type", "type")
WHERE "event_type" IS NULL;

INSERT INTO "audit_events" (
  "tenant_id",
  "tenant_sequence",
  "event_type",
  "actor_user_id",
  "action",
  "entity_type",
  "source_channel",
  "after",
  "summary",
  "reason"
)
SELECT
  n."tenant_id",
  COALESCE((SELECT MAX(a."tenant_sequence") FROM "audit_events" a WHERE a."tenant_id" = n."tenant_id"), 0) + 1,
  'legacy_notification_scope_migration',
  'system:migration',
  'archive',
  'notification_feed',
  'migration',
  jsonb_build_object('archived_count', COUNT(*)),
  'Legacy tenant-wide notifications archived from personal feeds',
  'Recipient-specific workspace notification migration'
FROM "notifications" n
WHERE n."audience" = 'activity' AND n."status" = 'archived'
GROUP BY n."tenant_id";

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key_idx"
  ON "notifications" ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "notifications_recipient_workspace_status_idx"
  ON "notifications" ("tenant_id", "recipient_user_id", "workspace", "status", "created_at" DESC);
