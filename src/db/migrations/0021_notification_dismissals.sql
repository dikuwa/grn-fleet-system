CREATE TABLE IF NOT EXISTS "notification_dismissals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "notification_id" uuid NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "dismissed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_dismissals_notification_user_idx"
  ON "notification_dismissals" ("notification_id", "user_id");
