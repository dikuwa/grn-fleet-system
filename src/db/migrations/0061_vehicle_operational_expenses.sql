-- Generalize the existing trip_expenses ledger so operational vehicle costs
-- (for example car washes or parking outside a scheduled trip) remain in the
-- same audit/reporting table instead of creating a parallel expense system.

ALTER TABLE "trip_expenses"
  ADD COLUMN IF NOT EXISTS "vehicle_id" uuid;

UPDATE "trip_expenses" AS expense
SET "vehicle_id" = trip."vehicle_id"
FROM "trips" AS trip
WHERE expense."trip_id" = trip."id"
  AND expense."vehicle_id" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trip_expenses_vehicle_id_vehicles_id_fk'
  ) THEN
    ALTER TABLE "trip_expenses"
      ADD CONSTRAINT "trip_expenses_vehicle_id_vehicles_id_fk"
      FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Every operational expense belongs to a vehicle. Existing rows are safe to
-- backfill because trip_expenses.trip_id previously required a valid trip.
ALTER TABLE "trip_expenses"
  ALTER COLUMN "vehicle_id" SET NOT NULL;

-- A trip is now optional: Transport Office may record legitimate vehicle costs
-- that are not associated with a scheduled journey.
ALTER TABLE "trip_expenses"
  ALTER COLUMN "trip_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_trip_expenses_vehicle"
  ON "trip_expenses" ("vehicle_id");

CREATE INDEX IF NOT EXISTS "idx_trip_expenses_tenant_transaction"
  ON "trip_expenses" ("tenant_id", "transaction_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_trip_expenses_tenant_category"
  ON "trip_expenses" ("tenant_id", "category");
