-- Schema Cleanup Migration 0007
-- 1. Create regions table (was defined in schema but missing from prior migrations)
-- 2. Add performance indexes on frequently queried columns
-- 3. Add missing foreign key constraints

-- ============================================================
-- 1. Regions table (was missing from initial migration)
-- ============================================================
CREATE TABLE IF NOT EXISTS "regions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ============================================================
-- 2. Foreign key constraints for regions
-- ============================================================
DO $$ BEGIN
  ALTER TABLE "regions" ADD CONSTRAINT "regions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ============================================================
-- 3. Performance indexes on common query patterns
-- ============================================================

-- Vehicle status lookups (dashboard, fleet list)
CREATE INDEX IF NOT EXISTS "idx_vehicles_tenant_status" ON "vehicles" ("tenant_id", "status");

-- Trip status lookups (active trips, closure review)
CREATE INDEX IF NOT EXISTS "idx_trips_tenant_status" ON "trips" ("tenant_id", "status");

-- Transport request status (pending approvals)
CREATE INDEX IF NOT EXISTS "idx_transport_requests_tenant_status" ON "transport_requests" ("tenant_id", "status");

-- Fuel transactions by date range (reports)
CREATE INDEX IF NOT EXISTS "idx_fuel_transactions_vehicle_date" ON "fuel_transactions" ("vehicle_id", "transaction_at");

-- Inspection lookups by vehicle
CREATE INDEX IF NOT EXISTS "idx_vehicle_inspections_vehicle" ON "vehicle_inspections" ("vehicle_id", "type", "created_at");

-- Audit events by tenant (activity log)
CREATE INDEX IF NOT EXISTS "idx_audit_events_tenant_created" ON "audit_events" ("tenant_id", "created_at");

-- Odometer history by vehicle
CREATE INDEX IF NOT EXISTS "idx_odometer_events_vehicle" ON "vehicle_odometer_events" ("vehicle_id", "created_at");

-- Notifications by recipient
CREATE INDEX IF NOT EXISTS "idx_notifications_recipient" ON "notifications" ("tenant_id", "recipient_user_id", "is_read");

-- Vehicle allocations by date range
CREATE INDEX IF NOT EXISTS "idx_allocations_vehicle_dates" ON "vehicle_allocations" ("vehicle_id", "start_at", "end_at");

-- Employee lookups by tenant
CREATE INDEX IF NOT EXISTS "idx_employees_tenant" ON "employees" ("tenant_id", "is_active", "is_driver");
