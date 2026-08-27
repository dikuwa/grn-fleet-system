-- Keep transport-request workflow state and operational allocation state atomic.
--
-- Two races are closed here:
-- 1. an allocator that passed an application pre-check must not create a live
--    allocation after the request has concurrently been returned/rejected; and
-- 2. returning/rejecting a request after Transport Review must retire any
--    provisional operational records before a corrected revision can be resubmitted.
--
-- The application still performs friendly pre-checks. These guards are the
-- database-level invariant for concurrent writers and all future call sites.

CREATE OR REPLACE FUNCTION guard_vehicle_allocation_concurrency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_id uuid;
  request_status text;
  enters_live_reservation boolean;
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

  -- Every live allocation write still uses the request advisory lock so a
  -- workflow return/reject and an allocation mutation cannot pass each other.
  PERFORM pg_advisory_xact_lock(hashtextextended('allocation-request:' || NEW.request_id::text, 0));

  -- Validate request lifecycle when a reservation is first created, moved to a
  -- different request, or resurrected from a non-live state. Ordinary progress
  -- of an existing reservation (for example confirmed -> issued after final
  -- authorisation) must remain legal even though the request has advanced past
  -- Transport Review by then.
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

-- A returned/rejected workflow revision is no longer operationally approved.
-- Retire provisional operational artifacts in the same transaction that
-- changes the request status. Started/issued trips are intentionally protected:
-- they must be handled through the operational lifecycle rather than rewinding
-- the approval workflow underneath an active trip.
CREATE OR REPLACE FUNCTION retire_request_operations_on_workflow_return()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  started_trip_id uuid;
BEGIN
  IF NEW.status NOT IN ('returned', 'rejected')
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT id
  INTO started_trip_id
  FROM trips
  WHERE request_id = NEW.id
    AND tenant_id = NEW.tenant_id
    AND (issued_at IS NOT NULL OR status NOT IN ('pending', 'cancelled'))
  LIMIT 1;

  IF started_trip_id IS NOT NULL THEN
    RAISE EXCEPTION 'request_workflow_return_after_trip_started:%', started_trip_id
      USING ERRCODE = '23514';
  END IF;

  UPDATE vehicle_allocations
  SET state = 'cancelled', updated_at = now()
  WHERE request_id = NEW.id
    AND state IN ('provisional', 'confirmed', 'issued');

  UPDATE trips
  SET status = 'cancelled', updated_at = now()
  WHERE request_id = NEW.id
    AND tenant_id = NEW.tenant_id
    AND status = 'pending';

  UPDATE trip_authorities
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, now()),
      cancellation_reason = COALESCE(
        NULLIF(cancellation_reason, ''),
        CASE
          WHEN NEW.status = 'returned' THEN 'Request returned for workflow revision'
          ELSE 'Request rejected in workflow'
        END
      ),
      updated_at = now()
  WHERE request_id = NEW.id
    AND tenant_id = NEW.tenant_id
    AND status <> 'cancelled';

  UPDATE request_drivers
  SET is_confirmed = false
  WHERE request_id = NEW.id
    AND is_confirmed = true;

  NEW.assigned_driver_employee_id := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_request_workflow_return_operations ON transport_requests;
CREATE TRIGGER trg_request_workflow_return_operations
BEFORE UPDATE OF status
ON transport_requests
FOR EACH ROW
EXECUTE FUNCTION retire_request_operations_on_workflow_return();