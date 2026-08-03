-- Programme management — reusable organisational activities linked to transport requests.
CREATE TABLE IF NOT EXISTS "programmes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "reference" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "purpose" text,
  "department_id" uuid REFERENCES "departments"("id") ON DELETE SET NULL,
  "department" text,
  "owner_employee_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL,
  "owner_user_id" text,
  "start_date" timestamptz,
  "end_date" timestamptz,
  "venue" text,
  "office_id" uuid REFERENCES "offices"("id") ON DELETE SET NULL,
  "region_id" uuid REFERENCES "regions"("id") ON DELETE SET NULL,
  "region" text,
  "expected_participants" integer,
  "planned_activities" text,
  "estimated_travel_requirement" text,
  "estimated_kilometres" integer,
  "status" text NOT NULL DEFAULT 'draft',
  "review_notes" text,
  "rejection_reason" text,
  "created_by_user_id" text NOT NULL,
  "reviewed_by_user_id" text,
  "approved_by_user_id" text,
  "published_by_user_id" text,
  "submitted_at" timestamptz,
  "reviewed_at" timestamptz,
  "approved_at" timestamptz,
  "published_at" timestamptz,
  "archived_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "programmes_tenant_reference_uidx"
  ON "programmes" ("tenant_id", "reference");
CREATE INDEX IF NOT EXISTS "programmes_tenant_status_idx"
  ON "programmes" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "programmes_tenant_dates_idx"
  ON "programmes" ("tenant_id", "start_date", "end_date");

-- Link transport requests to an approved/published Programme.
ALTER TABLE "transport_requests"
  ADD COLUMN IF NOT EXISTS "programme_id" uuid;

DO $$ BEGIN
  ALTER TABLE "transport_requests" ADD CONSTRAINT "transport_requests_programme_id_programmes_id_fk"
    FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "transport_requests_programme_idx"
  ON "transport_requests" ("tenant_id", "programme_id");
