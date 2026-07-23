-- Role/user/driver foundations required for repeatable multi-role workflows.
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "availability_status" text DEFAULT 'available' NOT NULL;
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "unavailable_until" timestamp with time zone;
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "last_verified_at" timestamp with time zone;
ALTER TABLE "driver_profiles" ADD COLUMN IF NOT EXISTS "verified_by_user_id" text;

ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "department_id" uuid;
ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "office_id" uuid;
ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "region_id" uuid;
ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "client_submission_id" text;
ALTER TABLE "workflow_definitions" ADD COLUMN IF NOT EXISTS "region_id" uuid;
ALTER TABLE "workflow_definitions" ADD COLUMN IF NOT EXISTS "office_id" uuid;
ALTER TABLE "workflow_definitions" ADD COLUMN IF NOT EXISTS "department_id" uuid;
ALTER TABLE "workflow_steps" ADD COLUMN IF NOT EXISTS "assigned_user_id" text;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "driver_acknowledged_at" timestamp with time zone;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "driver_acknowledged_by_employee_id" uuid;
ALTER TABLE "fuel_transactions" ADD COLUMN IF NOT EXISTS "client_sync_id" text;
DO $$ BEGIN
  ALTER TABLE "transport_requests" ADD CONSTRAINT "transport_requests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "transport_requests" ADD CONSTRAINT "transport_requests_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "offices"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_acknowledged_by_employee_id_employees_id_fk" FOREIGN KEY ("driver_acknowledged_by_employee_id") REFERENCES "employees"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "regions"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "offices"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Remove historical duplicate memberships/assignments before enforcing idempotency.
DELETE FROM "tenant_memberships" a USING "tenant_memberships" b
WHERE a."id" > b."id" AND a."tenant_id" = b."tenant_id" AND a."user_id" = b."user_id";
DELETE FROM "role_assignments" a USING "role_assignments" b
WHERE a."id" > b."id" AND a."tenant_membership_id" = b."tenant_membership_id" AND a."role_id" = b."role_id";
DELETE FROM "workflow_actions" a USING "workflow_actions" b
WHERE a."id" > b."id" AND a."instance_id" = b."instance_id" AND a."step_order" = b."step_order";

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenant_user_unique" ON "tenant_memberships" ("tenant_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "role_assignments_membership_role_unique" ON "role_assignments" ("tenant_membership_id", "role_id");
CREATE UNIQUE INDEX IF NOT EXISTS "employees_tenant_number_unique" ON "employees" ("tenant_id", "employee_number");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_tenant_name_unique" ON "roles" ("tenant_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "offices_tenant_code_unique" ON "offices" ("tenant_id", "code") WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "departments_tenant_code_unique" ON "departments" ("tenant_id", "code") WHERE "code" IS NOT NULL;
DROP INDEX IF EXISTS "workflow_definitions_tenant_scope_version_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definitions_route_version_unique" ON "workflow_definitions" ("tenant_id", "trip_scope", "version", COALESCE("region_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("office_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("department_id", '00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_steps_definition_order_unique" ON "workflow_steps" ("definition_id", "step_order");
CREATE UNIQUE INDEX IF NOT EXISTS "transport_requests_tenant_submission_unique" ON "transport_requests" ("tenant_id", "client_submission_id") WHERE "client_submission_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "trip_log_entries_trip_sync_unique" ON "trip_log_entries" ("trip_id", "client_sync_id") WHERE "client_sync_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "fuel_transactions_trip_sync_unique" ON "fuel_transactions" ("trip_id", "client_sync_id") WHERE "client_sync_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_actions_instance_step_unique" ON "workflow_actions" ("instance_id", "step_order");

CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_no_active_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("state" IN ('provisional', 'confirmed', 'issued'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_driver_no_active_overlap"
  EXCLUDE USING gist ("driver_employee_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("driver_employee_id" IS NOT NULL AND "state" IN ('provisional', 'confirmed', 'issued'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
