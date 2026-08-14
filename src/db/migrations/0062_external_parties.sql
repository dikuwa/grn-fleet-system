CREATE TABLE IF NOT EXISTS "external_parties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "organisation_name" text NOT NULL,
  "organisation_type" text DEFAULT 'other' NOT NULL,
  "id_reference" text,
  "email" text,
  "phone" text,
  "status" text DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_parties_tenant_name"
  ON "external_parties" ("tenant_id", "last_name", "first_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_parties_tenant_organisation"
  ON "external_parties" ("tenant_id", "organisation_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_parties_tenant_status"
  ON "external_parties" ("tenant_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_driver_licences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "external_party_id" uuid NOT NULL REFERENCES "external_parties"("id") ON DELETE CASCADE,
  "version" integer DEFAULT 1 NOT NULL,
  "licence_number" text NOT NULL,
  "licence_class" text NOT NULL,
  "issue_date" date,
  "expiry_date" date NOT NULL,
  "front_image_key" text NOT NULL,
  "back_image_key" text NOT NULL,
  "verification_status" text DEFAULT 'awaiting_review' NOT NULL,
  "review_notes" text,
  "extracted_data" jsonb DEFAULT '{}'::jsonb,
  "verified_by_user_id" text,
  "verified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_driver_licence_number"
  ON "external_driver_licences" ("tenant_id", "licence_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_driver_licence_party"
  ON "external_driver_licences" ("external_party_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_driver_licence_review"
  ON "external_driver_licences" ("tenant_id", "verification_status");
--> statement-breakpoint
ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "requester_type" text DEFAULT 'internal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "external_requester_id" uuid REFERENCES "external_parties"("id");
--> statement-breakpoint
ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "preferred_driver_external_party_id" uuid REFERENCES "external_parties"("id");
--> statement-breakpoint
ALTER TABLE "transport_requests" ADD COLUMN IF NOT EXISTS "assigned_driver_external_party_id" uuid REFERENCES "external_parties"("id");
--> statement-breakpoint
ALTER TABLE "transport_requests" DROP CONSTRAINT IF EXISTS "chk_transport_request_external_identity";
--> statement-breakpoint
ALTER TABLE "transport_requests" ADD CONSTRAINT "chk_transport_request_external_identity" CHECK (
  ("requester_type" = 'internal' AND "external_requester_id" IS NULL)
  OR
  ("requester_type" = 'external' AND "external_requester_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_request_drivers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "transport_requests"("id") ON DELETE CASCADE,
  "external_party_id" uuid NOT NULL REFERENCES "external_parties"("id"),
  "driver_type" text DEFAULT 'nominated' NOT NULL,
  "sort_order" integer DEFAULT 1 NOT NULL,
  "is_confirmed" boolean DEFAULT false NOT NULL,
  "licence_validated" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_external_request_driver"
  ON "external_request_drivers" ("request_id", "external_party_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_request_driver_party"
  ON "external_request_drivers" ("external_party_id");
