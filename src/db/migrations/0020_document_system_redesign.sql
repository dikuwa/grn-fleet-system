ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "short_slug" text;
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "verification_code" text;
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "access_policy" jsonb DEFAULT '{"allowPreview":true,"allowDownload":false}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_share_links_short_slug" ON "share_links" ("short_slug");
CREATE INDEX IF NOT EXISTS "idx_share_links_tenant_document" ON "share_links" ("tenant_id", "document_id");

ALTER TABLE "request_passengers" ADD COLUMN IF NOT EXISTS "external_id_reference" text;
ALTER TABLE "request_passengers" ADD COLUMN IF NOT EXISTS "external_organisation" text;
ALTER TABLE "request_passengers" ADD COLUMN IF NOT EXISTS "external_phone" text;
ALTER TABLE "request_passengers" ADD COLUMN IF NOT EXISTS "external_email" text;
ALTER TABLE "request_passengers" ADD COLUMN IF NOT EXISTS "traveller_role" text DEFAULT 'passenger' NOT NULL;
ALTER TABLE "request_passengers" ADD COLUMN IF NOT EXISTS "reason_for_travel" text;

ALTER TABLE "trip_authorities" ADD COLUMN IF NOT EXISTS "authority_number_source" text DEFAULT 'automatic' NOT NULL;
ALTER TABLE "trip_authorities" ADD COLUMN IF NOT EXISTS "manual_number_override_reason" text;
ALTER TABLE "trip_authorities" ADD COLUMN IF NOT EXISTS "manual_number_override_by_user_id" text;
ALTER TABLE "trip_authorities" ADD COLUMN IF NOT EXISTS "manual_number_override_at" timestamp with time zone;

ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "signature_type" text;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "signature_ref" text;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "signature_typed_name" text;
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "signature_confirmed_at" timestamp with time zone;

INSERT INTO "permissions" ("code", "name", "description", "group")
VALUES (
  'tripAuthority:overrideNumber',
  'Override Trip Authority Number',
  'Enter a unique manual Trip Authority number with a recorded operational reason',
  'Trip Authority'
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT "id", 'tripAuthority:overrideNumber'
FROM "roles"
WHERE "name" IN ('Tenant Administrator', 'Transport Administrator')
ON CONFLICT DO NOTHING;
