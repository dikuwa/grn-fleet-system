ALTER TABLE "offices" ADD COLUMN IF NOT EXISTS "town" text;
ALTER TABLE "offices" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'department';
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

DO $$ BEGIN
  ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "department_offices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "department_id" uuid NOT NULL REFERENCES "departments"("id") ON DELETE CASCADE,
  "office_id" uuid NOT NULL REFERENCES "offices"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "department_offices_tenant_department_office_uidx"
  ON "department_offices" ("tenant_id", "department_id", "office_id");
CREATE INDEX IF NOT EXISTS "department_offices_office_idx"
  ON "department_offices" ("tenant_id", "office_id");

-- Preserve the current inferred relationships before switching counts to the explicit mapping.
INSERT INTO "department_offices" ("tenant_id", "department_id", "office_id")
SELECT DISTINCT "tenant_id", "department_id", "office_id"
FROM "employees"
WHERE "department_id" IS NOT NULL AND "office_id" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "employee_number_counters" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "next_value" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "employee_number_counters" ("tenant_id", "next_value")
SELECT "tenant_id", COALESCE(MAX((regexp_match("employee_number", '([0-9]+)$'))[1]::integer), 0)
FROM "employees"
GROUP BY "tenant_id"
ON CONFLICT ("tenant_id") DO UPDATE
SET "next_value" = GREATEST("employee_number_counters"."next_value", EXCLUDED."next_value"),
    "updated_at" = now();

CREATE UNIQUE INDEX IF NOT EXISTS "employees_tenant_employee_number_uidx"
  ON "employees" ("tenant_id", "employee_number");
CREATE UNIQUE INDEX IF NOT EXISTS "offices_tenant_code_uidx"
  ON "offices" ("tenant_id", upper("code")) WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "departments_tenant_code_uidx"
  ON "departments" ("tenant_id", upper("code")) WHERE "code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "departments_tenant_parent_idx" ON "departments" ("tenant_id", "parent_id");
