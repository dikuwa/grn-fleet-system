CREATE TABLE IF NOT EXISTS "request_reference_sequences" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sequence_year" integer NOT NULL,
  "current_value" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_request_reference_sequence_tenant_year"
  ON "request_reference_sequences" ("tenant_id", "sequence_year");

CREATE TABLE IF NOT EXISTS "programme_reference_sequences" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sequence_year" integer NOT NULL,
  "current_value" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_programme_reference_sequence_tenant_year"
  ON "programme_reference_sequences" ("tenant_id", "sequence_year");

-- Historical references are intentionally preserved. Partial unique indexes
-- apply only to the new sequential formats so existing legacy/random values
-- cannot block this forward-only migration.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_transport_requests_tenant_reference_v2"
  ON "transport_requests" ("tenant_id", "reference")
  WHERE "reference" ~ '^GRN/TR/[0-9]{4}/[0-9]{6}$';

CREATE UNIQUE INDEX IF NOT EXISTS "uq_programmes_tenant_reference_v2"
  ON "programmes" ("tenant_id", "reference")
  WHERE "reference" ~ '^GRN/PGM/[0-9]{4}/[0-9]{6}$';
