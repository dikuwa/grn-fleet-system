-- Prevent concurrent Transport Officers from creating overlapping live allocations.
-- Application-level prechecks are still useful for friendly errors, but they are
-- not sufficient under concurrency. This trigger serializes competing writes by
-- request, vehicle, and driver inside the transaction, then re-checks for a live
-- overlap before the row is accepted.

CREATE OR REPLACE FUNCTION guard_vehicle_allocation_concurrency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_id uuid;
BEGIN
  -- Cancelled/released allocations do not reserve resources.
  IF NEW.state NOT IN ('provisional', 'confirmed', 'issued') THEN
    RETURN NEW;
  END IF;

  IF NEW.end_at <= NEW.start_at THEN
    RAISE EXCEPTION 'allocation_invalid_period'
      USING ERRCODE = '23514';
  END IF;

  -- Deterministic transaction-scoped locks. A concurrent transaction trying to
  -- allocate the same request/vehicle/driver waits here, then sees the committed
  -- winner during the overlap checks below.
  PERFORM pg_advisory_xact_lock(hashtextextended('allocation-request:' || NEW.request_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('allocation-vehicle:' || NEW.vehicle_id::text, 0));
  IF NEW.driver_employee_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('allocation-driver:' || NEW.driver_employee_id::text, 0));
  END IF;

  SELECT id
  INTO conflicting_id
  FROM vehicle_allocations
  WHERE request_id = NEW.request_id
    AND state IN ('provisional', 'confirmed', 'issued')
    AND id IS DISTINCT FROM NEW.id
  LIMIT 1;

  IF conflicting_id IS NOT NULL THEN
    RAISE EXCEPTION 'allocation_request_already_live'
      USING ERRCODE = '23P01';
  END IF;

  SELECT id
  INTO conflicting_id
  FROM vehicle_allocations
  WHERE vehicle_id = NEW.vehicle_id
    AND state IN ('provisional', 'confirmed', 'issued')
    AND id IS DISTINCT FROM NEW.id
    AND start_at < NEW.end_at
    AND end_at > NEW.start_at
  LIMIT 1;

  IF conflicting_id IS NOT NULL THEN
    RAISE EXCEPTION 'allocation_vehicle_overlap'
      USING ERRCODE = '23P01';
  END IF;

  IF NEW.driver_employee_id IS NOT NULL THEN
    SELECT id
    INTO conflicting_id
    FROM vehicle_allocations
    WHERE driver_employee_id = NEW.driver_employee_id
      AND state IN ('provisional', 'confirmed', 'issued')
      AND id IS DISTINCT FROM NEW.id
      AND start_at < NEW.end_at
      AND end_at > NEW.start_at
    LIMIT 1;

    IF conflicting_id IS NOT NULL THEN
      RAISE EXCEPTION 'allocation_driver_overlap'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_allocation_concurrency ON vehicle_allocations;
CREATE TRIGGER trg_vehicle_allocation_concurrency
BEFORE INSERT OR UPDATE OF request_id, vehicle_id, driver_employee_id, start_at, end_at, state
ON vehicle_allocations
FOR EACH ROW
EXECUTE FUNCTION guard_vehicle_allocation_concurrency();
