ALTER TABLE "notifications" ALTER COLUMN "recipient_user_id" DROP NOT NULL;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "audience" text DEFAULT 'user' NOT NULL;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "audience_target" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "required_role" text;

UPDATE "notifications"
SET "audience" = 'user'
WHERE "audience" IS NULL;

CREATE TABLE IF NOT EXISTS "notification_reads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_reads_notification_user_idx"
  ON "notification_reads" ("notification_id", "user_id");
CREATE INDEX IF NOT EXISTS "notifications_tenant_audience_created_idx"
  ON "notifications" ("tenant_id", "audience", "created_at" DESC);
