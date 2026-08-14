ALTER TABLE "generated_documents"
  ADD COLUMN IF NOT EXISTS "verification_slug" text,
  ADD COLUMN IF NOT EXISTS "verification_code" text;

UPDATE "generated_documents"
SET
  "verification_slug" = COALESCE(
    "verification_slug",
    'd-' || lower(substr(replace("id"::text, '-', ''), 1, 12))
  ),
  "verification_code" = COALESCE(
    "verification_code",
    upper(substr(replace("id"::text, '-', ''), 1, 8))
  );

ALTER TABLE "generated_documents"
  ALTER COLUMN "verification_slug" SET DEFAULT ('d-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  ALTER COLUMN "verification_code" SET DEFAULT (upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  ALTER COLUMN "verification_slug" SET NOT NULL,
  ALTER COLUMN "verification_code" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_generated_documents_verification_slug"
  ON "generated_documents" ("verification_slug");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_generated_documents_verification_code"
  ON "generated_documents" ("verification_code");
