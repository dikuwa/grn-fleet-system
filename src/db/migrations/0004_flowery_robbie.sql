-- Add missing columns to vehicles table to align with fleet.ts schema
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "licence_number" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "vehicle_register_number" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "vin" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "engine_number" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "series_name" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "manufacture_year" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "vehicle_category" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "vehicle_description" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "drive_type" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "tare_kg" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "gross_vehicle_mass_kg" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "seated_capacity" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "standing_capacity" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "registering_authority" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "national_vehicle_classification" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "roadworthy_test_date" date;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "licence_expiry_date" date;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "assigned_region_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "assigned_office_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "updated_by" text;--> statement-breakpoint

-- Backfill licence_number from grn_number for existing rows
UPDATE "vehicles" SET "licence_number" = "grn_number" WHERE "licence_number" IS NULL;--> statement-breakpoint

-- Backfill vehicle_register_number from registration_number for existing rows
UPDATE "vehicles" SET "vehicle_register_number" = "registration_number" WHERE "vehicle_register_number" IS NULL;--> statement-breakpoint

-- Backfill vehicle_description from body_type for existing rows
UPDATE "vehicles" SET "vehicle_description" = "body_type" WHERE "vehicle_description" IS NULL;--> statement-breakpoint

-- Backfill manufacture_year from year for existing rows
UPDATE "vehicles" SET "manufacture_year" = "year" WHERE "manufacture_year" IS NULL;--> statement-breakpoint

-- Make licence_number NOT NULL after backfill
ALTER TABLE "vehicles" ALTER COLUMN "licence_number" SET NOT NULL;
