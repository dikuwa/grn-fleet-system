-- Prevent the same external driver from being assigned to overlapping live
-- allocations concurrently. vehicle_allocations cannot protect this resource
-- because external drivers intentionally leave driver_employee_id NULL.
--
-- Application prechecks remain useful for friendly errors, but this trigger is
-- the source-of-truth concurrency boundary. A transaction-scoped advisory lock
-- serializes writes for the same tenant/external party before the overlap check.

CREATE OR REPLACE FUNCTION guard_external_driver_assignment_concurrency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_request_id uuid;
  v_trip_id uuid;
  v_tenant_id uuid;
  v_conflicting_id uuid;
BEGIN
  -- Terminal assignments do not reserve the external driver.
  IF NEW.state NOT IN ('pending_acceptance', 'accepted') THEN
    RETURN NEW;
  END IF;

  -- Resolve the allocation period and enforce that the assignment points at
  -- records belonging to one tenant/request/trip lifecycle.
  SELECT
    va.start_at,
    va.end_at,
    va.request_id,
    t.id,
    tr.tenant_id
  INTO
    v_start_at,
    v_end_at,
    v_request_id,
    v_trip_id,
    v_tenant_id
  FROM vehicle_allocations va
  INNER JOIN transport_requests tr
    ON tr.id = va.request_id
  INNER JOIN trips t
    ON t.allocation_id = va.id
   AND t.request_id = va.request_id
   AND t.tenant_id = tr.tenant_id
  WHERE va.id = NEW.allocation_id
    AND tr.id = NEW.request_id
    AND tr.tenant_id = NEW.tenant_id
    AND t.id = NEW.trip_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'external_driver_assignment_invalid_lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF v_tenant_id IS DISTINCT FROM NEW.tenant_id
     OR v_request_id IS DISTINCT FROM NEW.request_id
     OR v_trip_id IS DISTINCT FROM NEW.trip_id THEN
    RAISE EXCEPTION 'external_driver_assignment_tenant_or_lifecycle_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF v_end_at <= v_start_at THEN
    RAISE EXCEPTION 'external_driver_assignment_invalid_period'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'external-driver:' || NEW.tenant_id::text || ':' || NEW.external_party_id::text,
      0
    )
  );

  SELECT eda.id
  INTO v_conflicting_id
  FROM external_driver_assignments eda
  INNER JOIN vehicle_allocations existing_va
    ON existing_va.id = eda.allocation_id
  INNER JOIN transport_requests existing_tr
    ON existing_tr.id = eda.request_id
  INNER JOIN trips existing_trip
    ON existing_trip.id = eda.trip_id
   AND existing_trip.allocation_id = existing_va.id
   AND existing_trip.request_id = existing_tr.id
  WHERE eda.tenant_id = NEW.tenant_id
    AND existing_tr.tenant_id = NEW.tenant_id
    AND existing_trip.tenant_id = NEW.tenant_id
    AND eda.external_party_id = NEW.external_party_id
    AND eda.state IN ('pending_acceptance', 'accepted')
    AND eda.id IS DISTINCT FROM NEW.id
    AND existing_va.start_at < v_end_at
    AND existing_va.end_at > v_start_at
  LIMIT 1;

  IF v_conflicting_id IS NOT NULL THEN
    RAISE EXCEPTION 'external_driver_assignment_overlap'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_driver_assignment_concurrency
  ON external_driver_assignments;

CREATE TRIGGER trg_external_driver_assignment_concurrency
BEFORE INSERT OR UPDATE OF external_party_id, allocation_id, request_id, trip_id, state
ON external_driver_assignments
FOR EACH ROW
EXECUTE FUNCTION guard_external_driver_assignment_concurrency();
