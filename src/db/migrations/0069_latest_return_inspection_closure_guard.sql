-- A reinspection supersedes earlier return-inspection evidence for closure.
-- Rebuild the existing lifecycle guard so the database boundary evaluates the
-- newest return inspection for the current vehicle, matching the API preflight.

CREATE OR REPLACE FUNCTION enforce_trip_closure_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id uuid;
  v_request_id uuid;
  v_allocation_id uuid;
  v_vehicle_id uuid;
  v_trip_status text;
  v_allocation_state text;
  v_request_status text;
  v_authority_status text;
  v_return_inspection_status text;
BEGIN
  SELECT tenant_id, request_id, allocation_id, vehicle_id, status
    INTO v_tenant_id, v_request_id, v_allocation_id, v_vehicle_id, v_trip_status
  FROM trips
  WHERE id = NEW.trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: trip not found';
  END IF;

  IF v_trip_status NOT IN ('return_inspection', 'closure_review') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: trip status is %', v_trip_status;
  END IF;

  SELECT state
    INTO v_allocation_state
  FROM vehicle_allocations
  WHERE id = v_allocation_id
    AND request_id = v_request_id
    AND vehicle_id = v_vehicle_id
  FOR UPDATE;

  IF NOT FOUND OR v_allocation_state NOT IN ('provisional', 'confirmed') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: allocation is no longer active';
  END IF;

  SELECT status
    INTO v_request_status
  FROM transport_requests
  WHERE id = v_request_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_request_status <> 'in_progress' THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: request status is %', COALESCE(v_request_status, 'missing');
  END IF;

  SELECT status
    INTO v_authority_status
  FROM trip_authorities
  WHERE trip_id = NEW.trip_id
    AND tenant_id = v_tenant_id
    AND allocation_id = v_allocation_id
  FOR UPDATE;

  IF NOT FOUND OR v_authority_status NOT IN ('awaiting_reconciliation', 'completed') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: authority status is %', COALESCE(v_authority_status, 'missing');
  END IF;

  -- Only the newest return inspection for the currently allocated vehicle can
  -- satisfy reconciliation. Starting a reinspection invalidates reliance on an
  -- older submitted inspection until the new one is itself submitted.
  SELECT vi.status
    INTO v_return_inspection_status
  FROM vehicle_inspections vi
  WHERE vi.trip_id = NEW.trip_id
    AND vi.tenant_id = v_tenant_id
    AND vi.vehicle_id = v_vehicle_id
    AND vi.type = 'return'
  ORDER BY vi.created_at DESC, vi.id DESC
  LIMIT 1;

  IF v_return_inspection_status IS NULL
     OR v_return_inspection_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: latest return inspection status is %',
      COALESCE(v_return_inspection_status, 'missing');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM fuel_transactions ft
    JOIN vehicles v ON v.id = ft.vehicle_id
    WHERE ft.trip_id = NEW.trip_id
      AND v.tenant_id = v_tenant_id
      AND ft.is_verified = false
  ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: unverified fuel transaction remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trip_expenses te
    WHERE te.trip_id = NEW.trip_id
      AND te.tenant_id = v_tenant_id
      AND te.verification_status <> 'verified'
  ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: unverified expense remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trip_incidents ti
    WHERE ti.trip_id = NEW.trip_id
      AND ti.tenant_id = v_tenant_id
      AND ti.safe_to_continue = false
      AND ti.status <> 'resolved'
  ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: unresolved safety-critical incident remains';
  END IF;

  RETURN NEW;
END;
$$;

-- Serialize official inspection insertion against the same trip lifecycle row
-- used by closure. This prevents concurrent inspection submissions from both
-- preflighting the same state and leaving a stale second inspection committed.
CREATE OR REPLACE FUNCTION enforce_official_inspection_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
  v_trip_vehicle_id uuid;
  v_authority_status text;
BEGIN
  IF NEW.trip_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status, vehicle_id
    INTO v_trip_status, v_trip_vehicle_id
  FROM trips
  WHERE id = NEW.trip_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_trip_vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    RAISE EXCEPTION 'inspection_lifecycle_conflict: trip and vehicle are no longer current'
      USING ERRCODE = '23514';
  END IF;

  SELECT status
    INTO v_authority_status
  FROM trip_authorities
  WHERE trip_id = NEW.trip_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection_lifecycle_conflict: trip authority is missing'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.type = 'departure' THEN
    IF v_trip_status <> 'pending'
       OR v_authority_status NOT IN ('driver_accepted', 'awaiting_pre_trip_inspection') THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: departure inspection is no longer current'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.type = 'return' THEN
    IF v_trip_status NOT IN ('in_progress', 'return_due', 'return_inspection')
       OR v_authority_status NOT IN ('returned', 'awaiting_arrival_inspection') THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: return inspection is no longer current'
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
