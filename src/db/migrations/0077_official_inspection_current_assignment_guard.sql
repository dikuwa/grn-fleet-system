-- Keep official inspection creation bound to the current operational assignment.
-- The Inspector UI, attention badge and service all operate on the current
-- confirmed allocation. Enforce the same invariant at the database boundary so
-- stale/cancelled allocation state or stale external-driver evidence cannot be
-- used through a direct API call or a concurrent lifecycle race.

CREATE OR REPLACE FUNCTION enforce_official_inspection_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
  v_trip_vehicle_id uuid;
  v_request_id uuid;
  v_allocation_id uuid;
  v_request_status text;
  v_allocation_state text;
  v_driver_employee_id uuid;
  v_authority_id uuid;
  v_authority_status text;
  v_authority_accepted_at timestamptz;
BEGIN
  IF NEW.trip_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status, vehicle_id, request_id, allocation_id
    INTO v_trip_status, v_trip_vehicle_id, v_request_id, v_allocation_id
  FROM trips
  WHERE id = NEW.trip_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_trip_vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    RAISE EXCEPTION 'inspection_lifecycle_conflict: trip and vehicle are no longer current'
      USING ERRCODE = '23514';
  END IF;

  SELECT status
    INTO v_request_status
  FROM transport_requests
  WHERE id = v_request_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection_lifecycle_conflict: transport request is missing'
      USING ERRCODE = '23514';
  END IF;

  SELECT state, driver_employee_id
    INTO v_allocation_state, v_driver_employee_id
  FROM vehicle_allocations
  WHERE id = v_allocation_id
    AND request_id = v_request_id
    AND vehicle_id = v_trip_vehicle_id
  FOR UPDATE;

  IF NOT FOUND OR v_allocation_state <> 'confirmed' THEN
    RAISE EXCEPTION 'inspection_lifecycle_conflict: vehicle allocation is no longer confirmed'
      USING ERRCODE = '23514';
  END IF;

  SELECT id, status, accepted_at
    INTO v_authority_id, v_authority_status, v_authority_accepted_at
  FROM trip_authorities
  WHERE trip_id = NEW.trip_id
    AND request_id = v_request_id
    AND allocation_id = v_allocation_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection_lifecycle_conflict: trip authority is missing'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.type = 'departure' THEN
    IF v_trip_status <> 'pending'
       OR v_request_status NOT IN ('authorised', 'ready_for_issue', 'approved', 'approved_emergency')
       OR v_authority_status NOT IN ('driver_accepted', 'awaiting_pre_trip_inspection')
       OR v_authority_accepted_at IS NULL THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: departure inspection is no longer current'
        USING ERRCODE = '23514';
    END IF;

    IF v_driver_employee_id IS NULL AND NOT EXISTS (
      SELECT 1
      FROM external_driver_assignments eda
      WHERE eda.tenant_id = NEW.tenant_id
        AND eda.trip_id = NEW.trip_id
        AND eda.allocation_id = v_allocation_id
        AND eda.state = 'accepted'
    ) THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: accepted driver assignment is missing'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM trip_amendments am
      WHERE am.authority_id = v_authority_id
        AND am.amendment_type IN (
          'vehicle_replacement',
          'date_extension',
          'route_change',
          'purpose_clarification',
          'special_authorisation'
        )
        AND am.status = 'approved'
        AND COALESCE(am.approved_at, am.created_at) > v_authority_accepted_at
    ) THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: revised Trip Authority requires driver acknowledgement before departure inspection'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.type = 'return' THEN
    IF v_trip_status NOT IN ('in_progress', 'return_due', 'return_inspection')
       OR v_authority_status NOT IN ('returned', 'awaiting_arrival_inspection') THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: return inspection is no longer current'
        USING ERRCODE = '23514';
    END IF;

    IF v_driver_employee_id IS NULL AND NOT EXISTS (
      SELECT 1
      FROM external_driver_assignments eda
      WHERE eda.tenant_id = NEW.tenant_id
        AND eda.trip_id = NEW.trip_id
        AND eda.allocation_id = v_allocation_id
        AND eda.state = 'accepted'
        AND eda.issue_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: issued external-driver assignment is missing'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'inspection_lifecycle_conflict: unsupported inspection type %', NEW.type
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_official_inspection_lifecycle ON vehicle_inspections;
CREATE TRIGGER trg_enforce_official_inspection_lifecycle
BEFORE INSERT ON vehicle_inspections
FOR EACH ROW
WHEN (NEW.trip_id IS NOT NULL)
EXECUTE FUNCTION enforce_official_inspection_lifecycle();
