-- Restore the vehicle-safety clauses that were lost when migration 0096
-- expanded guard_vehicle_allocation_concurrency() with request lifecycle checks.
--
-- This definition deliberately combines both invariants:
--   * request lifecycle must still be allocatable; and
--   * a fresh/re-targeted live reservation must serialize against the current
--     vehicle row and reject non-available vehicles or unresolved blocking
--     defects.
--
-- Application pre-checks remain useful for friendly errors, but this function
-- is the database-level race boundary for all allocation writers.

CREATE OR REPLACE FUNCTION guard_vehicle_allocation_concurrency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_id uuid;
  request_status text;
  current_vehicle_status text;
  enters_live_reservation boolean;
  requires_available_vehicle boolean;
BEGIN
  -- Cancelled/released allocations do not reserve resources and must remain
  -- writable by lifecycle cleanup without re-entering allocation validation.
  IF NEW.state NOT IN ('provisional', 'confirmed', 'issued') THEN
    RETURN NEW;
  END IF;

  IF NEW.end_at <= NEW.start_at THEN
    RAISE EXCEPTION 'allocation_invalid_period'
      USING ERRCODE = '23514';
  END IF;

  -- Serialize request lifecycle changes and allocation creation/retargeting.
  PERFORM pg_advisory_xact_lock(hashtextextended('allocation-request:' || NEW.request_id::text, 0));

  enters_live_reservation :=
    TG_OP = 'INSERT'
    OR OLD.request_id IS DISTINCT FROM NEW.request_id
    OR OLD.state NOT IN ('provisional', 'confirmed', 'issued');

  IF enters_live_reservation THEN
    SELECT status
    INTO request_status
    FROM transport_requests
    WHERE id = NEW.request_id
    FOR UPDATE;

    IF request_status IS NULL THEN
      RAISE EXCEPTION 'allocation_request_not_found'
        USING ERRCODE = '23503';
    END IF;

    IF request_status NOT IN (
      'approved',
      'under_review',
      'transport_review',
      'release_pending',
      'vehicle_allocated'
    ) THEN
      RAISE EXCEPTION 'allocation_request_not_allocatable:%', request_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Keep a deterministic per-vehicle lock and then lock the canonical vehicle
  -- row. Incident, inspection, maintenance and other safety transitions update
  -- the same row, so the winner establishes the ordering before this allocation
  -- can become live.
  PERFORM pg_advisory_xact_lock(hashtextextended('allocation-vehicle:' || NEW.vehicle_id::text, 0));

  SELECT v.status
  INTO current_vehicle_status
  FROM vehicles v
  WHERE v.id = NEW.vehicle_id
  FOR UPDATE;

  IF current_vehicle_status IS NULL THEN
    RAISE EXCEPTION 'allocation_vehicle_not_found'
      USING ERRCODE = '23503';
  END IF;

  requires_available_vehicle := false;
  IF NEW.state IN ('provisional', 'confirmed') THEN
    IF TG_OP = 'INSERT' THEN
      requires_available_vehicle := true;
    ELSE
      requires_available_vehicle :=
        OLD.state NOT IN ('provisional', 'confirmed', 'issued')
        OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
        OR NEW.start_at IS DISTINCT FROM OLD.start_at
        OR NEW.end_at IS DISTINCT FROM OLD.end_at;
    END IF;
  END IF;

  -- Issued allocations are excluded from this status clause because the
  -- physical-issue lifecycle can legitimately move the vehicle out of
  -- "available" after reservation. Fresh/re-targeted reservations may not.
  IF requires_available_vehicle AND current_vehicle_status <> 'available' THEN
    RAISE EXCEPTION 'allocation_vehicle_not_available'
      USING ERRCODE = '23514';
  END IF;

  -- Blocking defects are independent of vehicle status and must remain a hard
  -- database invariant for every live allocation write.
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
