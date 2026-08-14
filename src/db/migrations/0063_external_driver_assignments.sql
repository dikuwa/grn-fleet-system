CREATE TABLE IF NOT EXISTS "external_driver_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "request_id" uuid NOT NULL REFERENCES "transport_requests"("id") ON DELETE CASCADE,
  "allocation_id" uuid NOT NULL REFERENCES "vehicle_allocations"("id") ON DELETE CASCADE,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "external_party_id" uuid NOT NULL REFERENCES "external_parties"("id"),
  "licence_id" uuid NOT NULL REFERENCES "external_driver_licences"("id"),
  "issue_id" uuid REFERENCES "trip_issues"("id"),
  "state" text DEFAULT 'pending_acceptance' NOT NULL,
  "driver_type" text DEFAULT 'assigned' NOT NULL,
  "licence_snapshot" jsonb NOT NULL,
  "assigned_by_user_id" text NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "acceptance_method" text,
  "acceptance_note" text,
  "accepted_at" timestamp with time zone,
  "accepted_recorded_by_user_id" text,
  "cancelled_at" timestamp with time zone,
  "cancellation_reason" text,
  "cancelled_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_external_driver_assignment_state" CHECK ("state" IN ('pending_acceptance', 'accepted', 'cancelled')),
  CONSTRAINT "chk_external_driver_acceptance_method" CHECK ("acceptance_method" IS NULL OR "acceptance_method" IN ('in_person', 'phone', 'signed_paper', 'secure_link'))
);

CREATE INDEX IF NOT EXISTS "idx_external_driver_assignments_tenant_state"
  ON "external_driver_assignments" ("tenant_id", "state");
CREATE INDEX IF NOT EXISTS "idx_external_driver_assignments_request"
  ON "external_driver_assignments" ("request_id");
CREATE INDEX IF NOT EXISTS "idx_external_driver_assignments_trip"
  ON "external_driver_assignments" ("trip_id");
CREATE INDEX IF NOT EXISTS "idx_external_driver_assignments_party"
  ON "external_driver_assignments" ("external_party_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_external_driver_assignment_issue"
  ON "external_driver_assignments" ("issue_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_external_driver_assignment_live_allocation"
  ON "external_driver_assignments" ("allocation_id")
  WHERE "state" IN ('pending_acceptance', 'accepted');
CREATE UNIQUE INDEX IF NOT EXISTS "uq_external_driver_assignment_live_trip"
  ON "external_driver_assignments" ("trip_id")
  WHERE "state" IN ('pending_acceptance', 'accepted');
