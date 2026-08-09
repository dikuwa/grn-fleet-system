CREATE TABLE IF NOT EXISTS "request_reference_sequences" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sequence_year" integer NOT NULL,
  "current_value" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_request_reference_sequence_tenant_year"
  ON "request_reference_sequences" ("tenant_id", "sequence_year");

-- Future sequential request references use GRN/TR/YYYY/NNNNNN. Historical
-- references are intentionally preserved. The partial index enforces uniqueness
-- only for the new format so legacy duplicate/random references cannot block the
-- forward-only migration.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_transport_requests_tenant_reference_v2"
  ON "transport_requests" ("tenant_id", "reference")
  WHERE "reference" ~ '^GRN/TR/[0-9]{4}/[0-9]{6}$';
