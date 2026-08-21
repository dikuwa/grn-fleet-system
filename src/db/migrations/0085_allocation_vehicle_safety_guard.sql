-- Extend the allocation concurrency guard so a live allocation cannot be
-- created from stale vehicle-safety state. The vehicle row lock serializes
-- allocation creation against incident/inspection paths that move a vehicle
-- into maintenance or another restricted state.

CREATE OR REPLACE FUNCTION guard_vehicle_allocation_concurrency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_id uuid;
  current_vehicle_status text;
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

  -- Lock the vehicle row before accepting a new/provisional/confirmed live
  -- allocation. Critical incident and inspection workflows update the same row,
  -- so whichever transaction obtains this lock first establishes the ordering.
  SELECT v.status
  INTO current_vehicle_status
  FROM vehicles v
  WHERE v.id = NEW.vehicle_id
  FOR UPDATE;

  IF current_vehicle_status IS NULL THEN
    RAISE EXCEPTION 'allocation_vehicle_not_found'
      USING ERRCODE = '23503';
  END IF;

  -- A fresh or reactivated allocation may reserve only a currently available
  -- vehicle. Issued allocations are excluded from this status check because the
  -- physical-issue lifecycle can legitimately move the vehicle out of available.
  IF NEW.state IN ('provisional', 'confirmed')
     AND (
       TG_OP = 'INSERT'
       OR OLD.state NOT IN ('provisional', 'confirmed', 'issued')
       OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
       OR NEW.start_at IS DISTINCT FROM OLD.start_at
       OR NEW.end_at IS DISTINCT FROM OLD.end_at
     )
     AND current_vehicle_status <> 'available' THEN
    RAISE EXCEPTION 'allocation_vehicle_not_available'
      USING ERRCODE = '23514';
  END IF;

  -- Blocking defects are an independent allocation gate. This also protects
  -- callers that bypass the normal Transport UI/API precheck.
  IF EXISTS (
    SELECT 1
    FROM vehicle_defects vd
    WHERE vd.vehicle_id = NEW.vehicle_id
      AND vd.is_blocking = true
      AND vd.resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'allocation_vehicle_blocking_defect'
      USING ERRCODE = '23514';
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
