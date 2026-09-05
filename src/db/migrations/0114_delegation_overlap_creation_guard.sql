CREATE OR REPLACE FUNCTION enforce_role_delegation_creation_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('scheduled', 'active') THEN
    RETURN NEW;
  END IF;

  IF NULLIF(BTRIM(COALESCE(NEW.override_reason, '')), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Delegation creation is a low-volume administrative action. A tenant-scoped
  -- transaction advisory lock serializes the conflict check without validating
  -- or rewriting historical rows and avoids cross-tenant contention.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('role_delegation_creation:' || NEW.tenant_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM role_delegations existing
    WHERE existing.tenant_id = NEW.tenant_id
      AND existing.status IN ('scheduled', 'active')
      AND existing.start_at < NEW.end_at
      AND existing.end_at > NEW.start_at
      AND (
        existing.role_id = NEW.role_id
        OR existing.acting_employee_id = NEW.acting_employee_id
      )
  ) THEN
    RAISE EXCEPTION 'role_delegation_overlap_conflict'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_delegation_creation_overlap_guard ON role_delegations;
CREATE TRIGGER trg_role_delegation_creation_overlap_guard
BEFORE INSERT ON role_delegations
FOR EACH ROW
EXECUTE FUNCTION enforce_role_delegation_creation_overlap_guard();
