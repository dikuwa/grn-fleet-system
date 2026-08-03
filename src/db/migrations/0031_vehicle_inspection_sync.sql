-- Offline inspection sync — idempotent client-submission key for vehicle inspections.
ALTER TABLE "vehicle_inspections"
  ADD COLUMN IF NOT EXISTS "client_sync_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_vehicle_inspections_tenant_sync"
  ON "vehicle_inspections" ("tenant_id", "client_sync_id");
