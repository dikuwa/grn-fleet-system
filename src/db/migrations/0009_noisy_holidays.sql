CREATE TABLE IF NOT EXISTS "tenant_holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "holiday_date" timestamp with time zone NOT NULL,
  "is_recurring_yearly" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_tenant_holidays_tenant" ON "tenant_holidays" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_holidays_date" ON "tenant_holidays" ("holiday_date");
