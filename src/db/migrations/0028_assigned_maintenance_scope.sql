ALTER TABLE "vehicle_defects"
  ADD COLUMN IF NOT EXISTS "assigned_to_user_id" text;

ALTER TABLE "maintenance_events"
  ADD COLUMN IF NOT EXISTS "assigned_to_user_id" text;

CREATE INDEX IF NOT EXISTS "vehicle_defects_assigned_user_idx"
  ON "vehicle_defects" ("assigned_to_user_id", "resolved_at");

CREATE INDEX IF NOT EXISTS "maintenance_events_assigned_user_idx"
  ON "maintenance_events" ("assigned_to_user_id", "service_date" DESC);
