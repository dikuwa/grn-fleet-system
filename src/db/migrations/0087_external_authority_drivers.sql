CREATE TABLE IF NOT EXISTS "trip_authorised_external_drivers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "authority_id" uuid NOT NULL REFERENCES "trip_authorities"("id") ON DELETE CASCADE,
  "external_party_id" uuid NOT NULL REFERENCES "external_parties"("id"),
  "external_driver_licence_id" uuid NOT NULL REFERENCES "external_driver_licences"("id"),
  "driver_type" text DEFAULT 'primary' NOT NULL,
  "licence_number_masked" text,
  "licence_class" text,
  "licence_expiry" timestamp with time zone,
  "acceptance_method" text,
  "acceptance_note" text,
  "accepted_at" timestamp with time zone,
  "authorised_by_user_id" text,
  "authorised_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_trip_authorised_external_driver_type"
    CHECK ("driver_type" IN ('primary', 'additional'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_trip_authorised_external_authority_party"
  ON "trip_authorised_external_drivers" ("authority_id", "external_party_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_trip_authorised_external_primary"
  ON "trip_authorised_external_drivers" ("authority_id")
  WHERE "driver_type" = 'primary';

CREATE INDEX IF NOT EXISTS "idx_trip_authorised_external_party"
  ON "trip_authorised_external_drivers" ("external_party_id");
