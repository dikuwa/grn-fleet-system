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

-- Preserve all historical request rows while reconciling any retry keys that
-- duplicated before database-level idempotency existed. The earliest request
-- keeps the key; later duplicates retain their complete business record but
-- release the retry token so the unique index can be added safely.
WITH ranked_submission_keys AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, client_submission_id
      ORDER BY created_at ASC, id ASC
    ) AS occurrence
  FROM transport_requests
  WHERE client_submission_id IS NOT NULL
)
UPDATE transport_requests tr
SET client_submission_id = NULL
FROM ranked_submission_keys ranked
WHERE tr.id = ranked.id
  AND ranked.occurrence > 1;

-- Idempotency must be enforced by the database, not only by a pre-insert
-- application lookup. Two concurrent retries with the same client submission
-- key can otherwise both pass the lookup and create duplicate requests.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_transport_requests_tenant_client_submission"
  ON "transport_requests" ("tenant_id", "client_submission_id")
  WHERE "client_submission_id" IS NOT NULL;
