-- Keep the database inspection boundary aligned with the Trip Authority
-- re-acceptance lifecycle. Any approved driver-material amendment that became
-- effective after the current driver acceptance invalidates departure
-- inspection until the revised authority is acknowledged again.

CREATE OR REPLACE FUNCTION enforce_official_inspection_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
  v_trip_vehicle_id uuid;
  v_authority_id uuid;
  v_authority_status text;
  v_authority_accepted_at timestamptz;
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

  SELECT id, status, accepted_at
    INTO v_authority_id, v_authority_status, v_authority_accepted_at
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
       OR v_authority_status NOT IN ('driver_accepted', 'awaiting_pre_trip_inspection')
       OR v_authority_accepted_at IS NULL THEN
      RAISE EXCEPTION 'inspection_lifecycle_conflict: departure inspection is no longer current'
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
