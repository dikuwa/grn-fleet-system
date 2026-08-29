-- Preserve the latest allocation lifecycle/concurrency guard from migration 0096
-- while allowing the driver-handover endpoint to classify a concurrent
-- relief-driver overlap as an atomic handover conflict (409) instead of a
-- generic server error.
--
-- The allocation trigger remains the authoritative race boundary. This
-- migration keeps the 0096 request lifecycle lock/validation plus the existing
-- request/vehicle/driver advisory locks and overlap checks intact.

CREATE OR REPLACE FUNCTION guard_vehicle_allocation_concurrency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_id uuid;
  request_status text;
  enters_live_reservation boolean;
  is_pending_driver_handover boolean := false;
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
      -- Driver handover acknowledgement changes driver_employee_id on the
      -- already-live allocation after a pending relief-driver row was created.
      -- Tag only that path with the endpoint's existing atomic conflict marker;
      -- ordinary allocation creation/update keeps the established error marker.
      IF TG_OP = 'UPDATE'
         AND OLD.driver_employee_id IS DISTINCT FROM NEW.driver_employee_id THEN
        SELECT EXISTS (
          SELECT 1
          FROM trips t
          INNER JOIN trip_authorities ta ON ta.trip_id = t.id
          INNER JOIN trip_authorised_drivers tad ON tad.authority_id = ta.id
          WHERE t.allocation_id = NEW.id
            AND t.status IN ('in_progress', 'return_due')
            AND tad.employee_id = NEW.driver_employee_id
            AND tad.driver_type = 'relief'
            AND tad.acknowledged_at IS NULL
        )
        INTO is_pending_driver_handover;
      END IF;

      IF is_pending_driver_handover THEN
        RAISE EXCEPTION 'atomic_driver_handover_initiate_failed allocation_driver_overlap'
          USING ERRCODE = '23P01';
      END IF;

      RAISE EXCEPTION 'allocation_driver_overlap'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
