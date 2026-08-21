-- Align the database-level technical-clearance guard with the application
-- safety model. Vehicle damage, an explicitly unsafe vehicle, or a critical
-- incident all require the same blocking-defect clearance boundary.

CREATE OR REPLACE FUNCTION enforce_incident_technical_clearance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle_id uuid;
  v_requires_clearance boolean;
  v_old_requires_clearance boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.technical_clearance_status = 'cleared'
     AND NEW.technical_clearance_status IS DISTINCT FROM OLD.technical_clearance_status THEN
    RAISE EXCEPTION 'incident_technical_clearance_revocation_blocked: cleared technical clearance is terminal'
      USING ERRCODE = '23514';
  END IF;

  v_requires_clearance :=
    NEW.vehicle_damage IS TRUE
    OR NEW.vehicle_safe IS FALSE
    OR NEW.severity = 'critical';

  v_old_requires_clearance := false;
  IF TG_OP = 'UPDATE' THEN
    v_old_requires_clearance :=
      OLD.vehicle_damage IS TRUE
      OR OLD.vehicle_safe IS FALSE
      OR OLD.severity = 'critical';
  END IF;

  -- Recheck when technical clearance is first granted, and also when an already
  -- cleared incident later changes from non-safety to a safety-relevant state.
  IF NEW.technical_clearance_status <> 'cleared'
     OR NOT v_requires_clearance
     OR (
       TG_OP = 'UPDATE'
       AND OLD.technical_clearance_status IS NOT DISTINCT FROM NEW.technical_clearance_status
       AND v_old_requires_clearance
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

  -- Serialize the clearance decision against vehicle-state updates, then check
  -- the latest blocking-defect state inside the same transaction.
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
BEFORE INSERT OR UPDATE OF technical_clearance_status, vehicle_damage, vehicle_safe, severity, trip_id
ON trip_incidents
FOR EACH ROW
EXECUTE FUNCTION enforce_incident_technical_clearance();
