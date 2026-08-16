-- Keep vehicle-damage technical clearance behind the current blocking-defect state.
-- Application routes already perform this check, but it must also hold at the
-- database boundary so a concurrent defect insert or direct SQL/API path cannot
-- mark an unsafe vehicle as technically cleared.

CREATE OR REPLACE FUNCTION enforce_incident_technical_clearance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle_id uuid;
BEGIN
  IF NEW.technical_clearance_status <> 'cleared'
     OR NEW.vehicle_damage IS NOT TRUE
     OR (
       TG_OP = 'UPDATE'
       AND OLD.technical_clearance_status IS NOT DISTINCT FROM NEW.technical_clearance_status
     ) THEN
    RETURN NEW;
  END IF;

  SELECT t.vehicle_id
    INTO v_vehicle_id
  FROM trips t
  WHERE t.id = NEW.trip_id
    AND t.tenant_id = NEW.tenant_id;

  IF NOT FOUND OR v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'incident_technical_clearance_blocked: incident trip or vehicle is missing'
      USING ERRCODE = '23514';
  END IF;

  -- Serialize the clearance decision against concurrent writes that reference
  -- the same vehicle through foreign keys, then evaluate the latest defect state.
  PERFORM 1
  FROM vehicles v
  WHERE v.id = v_vehicle_id
    AND v.tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident_technical_clearance_blocked: vehicle is missing'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM vehicle_defects vd
    WHERE vd.vehicle_id = v_vehicle_id
      AND vd.is_blocking = true
      AND vd.resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'incident_technical_clearance_blocked: unresolved blocking vehicle defects remain'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_incident_technical_clearance ON trip_incidents;
CREATE TRIGGER trg_enforce_incident_technical_clearance
BEFORE INSERT OR UPDATE OF technical_clearance_status, vehicle_damage, trip_id ON trip_incidents
FOR EACH ROW
EXECUTE FUNCTION enforce_incident_technical_clearance();
