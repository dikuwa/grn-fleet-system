-- 0024_role_delegation_scope.sql
-- Acting-role delegations gain optional office / department / region scope so a
-- temporary appointment can be limited to a specific organisational unit.
-- The existing free-text organisational_unit is retained for legacy records.

ALTER TABLE "role_delegations" ADD COLUMN IF NOT EXISTS "office_id" uuid;
ALTER TABLE "role_delegations" ADD COLUMN IF NOT EXISTS "department_id" uuid;
ALTER TABLE "role_delegations" ADD COLUMN IF NOT EXISTS "region_id" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_delegations_office_id_fkey') THEN
    ALTER TABLE "role_delegations"
      ADD CONSTRAINT "role_delegations_office_id_fkey"
      FOREIGN KEY ("office_id") REFERENCES "offices" ("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_delegations_department_id_fkey') THEN
    ALTER TABLE "role_delegations"
      ADD CONSTRAINT "role_delegations_department_id_fkey"
      FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_delegations_region_id_fkey') THEN
    ALTER TABLE "role_delegations"
      ADD CONSTRAINT "role_delegations_region_id_fkey"
      FOREIGN KEY ("region_id") REFERENCES "regions" ("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "role_delegations_office_id_idx" ON "role_delegations" ("office_id");
CREATE INDEX IF NOT EXISTS "role_delegations_department_id_idx" ON "role_delegations" ("department_id");
CREATE INDEX IF NOT EXISTS "role_delegations_region_id_idx" ON "role_delegations" ("region_id");
