-- Replace the legacy one-row-per-membership/role invariant with the dated
-- history model used by User Management and acting-role delegation.
-- Non-overlapping historical/future assignments are valid; overlapping windows
-- for the same membership + role remain forbidden at the database boundary.

DROP INDEX IF EXISTS "role_assignments_membership_role_unique";

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  ALTER TABLE "role_assignments"
    ADD CONSTRAINT "role_assignments_no_overlapping_windows"
    EXCLUDE USING gist (
      "tenant_membership_id" WITH =,
      "role_id" WITH =,
      tstzrange("start_date", "end_date", '[)') WITH &&
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
