-- Technical clearance is a terminal safety decision in the current incident workflow.
-- The operational UI only grants clearance; it has no clearance-revocation workflow that
-- atomically re-restricts an already returned vehicle. Prevent direct SQL/API paths from
-- changing a cleared incident back to pending/not_cleared and leaving an available vehicle
-- with a contradictory safety state.

CREATE OR REPLACE FUNCTION enforce_incident_technical_clearance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.technical_clearance_status = 'cleared'
     AND NEW.technical_clearance_status IS DISTINCT FROM OLD.technical_clearance_status THEN
    RAISE EXCEPTION 'incident_technical_clearance_revocation_blocked: cleared technical clearance is terminal'
      USING ERRCODE = '23514';
  END IF;

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
