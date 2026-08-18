CREATE TABLE IF NOT EXISTS "fleet_payment_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider_type" text NOT NULL,
  "provider_name" text NOT NULL,
  "integration_mode" text NOT NULL DEFAULT 'manual',
  "is_default" boolean NOT NULL DEFAULT false,
  "require_for_release" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'active',
  "api_base_url" text,
  "api_client_id" text,
  "api_secret_env_key" text,
  "external_account_reference" text,
  "config" jsonb DEFAULT '{}'::jsonb,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fleet_payment_providers_tenant"
  ON "fleet_payment_providers" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fleet_payment_provider_type_tenant"
  ON "fleet_payment_providers" ("tenant_id", "provider_type");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fleet_payment_default_provider_tenant"
  ON "fleet_payment_providers" ("tenant_id")
  WHERE "is_default" = true AND "status" = 'active';

CREATE TABLE IF NOT EXISTS "fleet_payment_instruments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider_id" uuid NOT NULL REFERENCES "fleet_payment_providers"("id") ON DELETE CASCADE,
  "vehicle_id" uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "instrument_type" text NOT NULL DEFAULT 'card',
  "display_name" text,
  "masked_identifier" text NOT NULL,
  "external_reference" text,
  "status" text NOT NULL DEFAULT 'active',
  "valid_from" timestamptz,
  "valid_until" timestamptz,
  "allowed_categories" jsonb DEFAULT '[]'::jsonb,
  "spending_limit" numeric(12,2),
  "currency" text NOT NULL DEFAULT 'NAD',
  "notes" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fleet_payment_instruments_tenant_status"
  ON "fleet_payment_instruments" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_fleet_payment_instruments_vehicle"
  ON "fleet_payment_instruments" ("vehicle_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fleet_payment_instrument_external"
  ON "fleet_payment_instruments" ("provider_id", "external_reference")
  WHERE "external_reference" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "fleet_payment_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "instrument_id" uuid NOT NULL REFERENCES "fleet_payment_instruments"("id") ON DELETE RESTRICT,
  "allocation_id" uuid REFERENCES "vehicle_allocations"("id") ON DELETE SET NULL,
  "trip_id" uuid REFERENCES "trips"("id") ON DELETE SET NULL,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE RESTRICT,
  "driver_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "external_driver_id" uuid REFERENCES "external_parties"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'assigned',
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "assigned_by_user_id" text NOT NULL,
  "returned_at" timestamptz,
  "returned_by_user_id" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_fleet_payment_assignments_trip"
  ON "fleet_payment_assignments" ("trip_id");
CREATE INDEX IF NOT EXISTS "idx_fleet_payment_assignments_allocation"
  ON "fleet_payment_assignments" ("allocation_id");
CREATE INDEX IF NOT EXISTS "idx_fleet_payment_assignments_instrument"
  ON "fleet_payment_assignments" ("instrument_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fleet_payment_active_allocation_assignment"
  ON "fleet_payment_assignments" ("allocation_id")
  WHERE "allocation_id" IS NOT NULL AND "status" = 'assigned';

CREATE TABLE IF NOT EXISTS "fleet_payment_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider_id" uuid NOT NULL REFERENCES "fleet_payment_providers"("id") ON DELETE RESTRICT,
  "instrument_id" uuid REFERENCES "fleet_payment_instruments"("id") ON DELETE SET NULL,
  "assignment_id" uuid REFERENCES "fleet_payment_assignments"("id") ON DELETE SET NULL,
  "trip_id" uuid REFERENCES "trips"("id") ON DELETE SET NULL,
  "vehicle_id" uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "driver_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "external_driver_id" uuid REFERENCES "external_parties"("id") ON DELETE SET NULL,
  "external_transaction_id" text,
  "transaction_at" timestamptz NOT NULL,
  "merchant" text,
  "location" text,
  "category" text NOT NULL,
  "litres" numeric(10,2),
  "unit_price" numeric(10,3),
  "amount" numeric(12,2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'NAD',
  "odometer_reading" integer,
  "status" text NOT NULL DEFAULT 'approved',
  "source" text NOT NULL DEFAULT 'manual',
  "reconciliation_status" text NOT NULL DEFAULT 'unmatched',
  "reconciliation_confidence" integer,
  "matched_expense_id" uuid,
  "matched_fuel_transaction_id" uuid,
  "raw_data" jsonb DEFAULT '{}'::jsonb,
  "imported_by_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_fleet_payment_transaction_external"
  ON "fleet_payment_transactions" ("provider_id", "external_transaction_id")
  WHERE "external_transaction_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_fleet_payment_transactions_tenant_time"
  ON "fleet_payment_transactions" ("tenant_id", "transaction_at");
CREATE INDEX IF NOT EXISTS "idx_fleet_payment_transactions_reconciliation"
  ON "fleet_payment_transactions" ("tenant_id", "reconciliation_status");
CREATE INDEX IF NOT EXISTS "idx_fleet_payment_transactions_vehicle"
  ON "fleet_payment_transactions" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_fleet_payment_transactions_fuel"
  ON "fleet_payment_transactions" ("matched_fuel_transaction_id");

ALTER TABLE "trip_expenses"
  ADD COLUMN IF NOT EXISTS "payment_method" text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS "payment_instrument_id" uuid,
  ADD COLUMN IF NOT EXISTS "fleet_payment_transaction_id" uuid;

CREATE INDEX IF NOT EXISTS "idx_trip_expenses_payment_instrument"
  ON "trip_expenses" ("payment_instrument_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_expenses_payment_instrument_fk') THEN
    ALTER TABLE "trip_expenses"
      ADD CONSTRAINT "trip_expenses_payment_instrument_fk"
      FOREIGN KEY ("payment_instrument_id") REFERENCES "fleet_payment_instruments"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_expenses_fleet_payment_transaction_fk') THEN
    ALTER TABLE "trip_expenses"
      ADD CONSTRAINT "trip_expenses_fleet_payment_transaction_fk"
      FOREIGN KEY ("fleet_payment_transaction_id") REFERENCES "fleet_payment_transactions"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fleet_payment_transactions_expense_fk') THEN
    ALTER TABLE "fleet_payment_transactions"
      ADD CONSTRAINT "fleet_payment_transactions_expense_fk"
      FOREIGN KEY ("matched_expense_id") REFERENCES "trip_expenses"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fleet_payment_transactions_fuel_fk') THEN
    ALTER TABLE "fleet_payment_transactions"
      ADD CONSTRAINT "fleet_payment_transactions_fuel_fk"
      FOREIGN KEY ("matched_fuel_transaction_id") REFERENCES "fuel_transactions"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- KERC development tenant: register BlueFuel as the default provider without
-- inventing instruments or credentials. Production tenants can opt in through UI.
INSERT INTO "fleet_payment_providers" (
  "tenant_id", "provider_type", "provider_name", "integration_mode",
  "is_default", "require_for_release", "status", "created_by_user_id", "config"
)
SELECT
  t."id", 'standard_bank_bluefuel', 'Standard Bank BlueFuel', 'manual',
  true, false, 'active', COALESCE(t."created_by_user_id", 'system:migration'),
  '{"country":"NA","credentialStorage":"masked_only","apiContract":"not_configured"}'::jsonb
FROM "tenants" t
WHERE (t."id" = '00000000-0000-0000-0000-000000000001'::uuid
       OR lower(t."name") = lower('Kavango East Regional Council')
       OR lower(t."code") IN ('kerc', 'ke'))
  AND NOT EXISTS (
    SELECT 1 FROM "fleet_payment_providers" p
    WHERE p."tenant_id" = t."id" AND p."provider_type" = 'standard_bank_bluefuel'
  );

-- Allocation-side automation: an active instrument linked to the selected
-- vehicle is assigned without adding another mandatory form step. Default
-- provider wins; otherwise the newest valid active instrument is used.
CREATE OR REPLACE FUNCTION grn_auto_assign_fleet_payment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id uuid;
  v_instrument_id uuid;
BEGIN
  IF NEW.state NOT IN ('provisional', 'confirmed') THEN
    RETURN NEW;
  END IF;

  SELECT r.tenant_id INTO v_tenant_id
  FROM transport_requests r
  WHERE r.id = NEW.request_id;

  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.id INTO v_instrument_id
  FROM fleet_payment_instruments i
  JOIN fleet_payment_providers p ON p.id = i.provider_id
  WHERE i.tenant_id = v_tenant_id
    AND i.vehicle_id = NEW.vehicle_id
    AND i.status = 'active'
    AND p.status = 'active'
    AND (i.valid_from IS NULL OR i.valid_from <= NEW.start_at)
    AND (i.valid_until IS NULL OR i.valid_until >= NEW.end_at)
  ORDER BY p.is_default DESC, i.updated_at DESC
  LIMIT 1;

  IF v_instrument_id IS NOT NULL THEN
    INSERT INTO fleet_payment_assignments (
      tenant_id, instrument_id, allocation_id, vehicle_id, driver_employee_id,
      status, assigned_at, assigned_by_user_id, notes
    ) VALUES (
      v_tenant_id, v_instrument_id, NEW.id, NEW.vehicle_id, NEW.driver_employee_id,
      'assigned', now(), NEW.allocated_by_user_id, 'Automatically assigned from vehicle'
    ) ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_assign_fleet_payment ON vehicle_allocations;
CREATE TRIGGER trg_auto_assign_fleet_payment
AFTER INSERT OR UPDATE OF vehicle_id, driver_employee_id, start_at, end_at, state
ON vehicle_allocations
FOR EACH ROW EXECUTE FUNCTION grn_auto_assign_fleet_payment();

CREATE OR REPLACE FUNCTION grn_link_fleet_payment_trip()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fleet_payment_assignments
  SET trip_id = NEW.id
  WHERE allocation_id = NEW.allocation_id
    AND status = 'assigned'
    AND (trip_id IS NULL OR trip_id = NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_link_fleet_payment_trip ON trips;
CREATE TRIGGER trg_link_fleet_payment_trip
AFTER INSERT OR UPDATE OF allocation_id
ON trips
FOR EACH ROW EXECUTE FUNCTION grn_link_fleet_payment_trip();
