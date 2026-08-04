-- Fuel entry on-behalf-of attribution: the driver a fuel entry is attributed to,
-- which may differ from the user who physically recorded it (an officer can record
-- fuel on behalf of a driver).
ALTER TABLE "fuel_transactions"
  ADD COLUMN IF NOT EXISTS "driver_employee_id" uuid;

DO $$ BEGIN
  ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_driver_employee_id_employees_id_fk"
    FOREIGN KEY ("driver_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_fuel_transactions_driver_employee"
  ON "fuel_transactions" ("driver_employee_id");
