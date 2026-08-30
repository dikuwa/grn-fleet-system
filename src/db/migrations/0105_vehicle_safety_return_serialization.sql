-- Serialize vehicle return-to-service with fresh blocking safety evidence.
--
-- The vehicle row is the authoritative lock boundary. New unresolved blocking
-- evidence claims that row before it becomes visible; transitions to `available`
-- already hold the same row lock and this BEFORE UPDATE trigger then performs a
-- fresh Read Committed blocker check from PL/pgSQL. This avoids the inconsistent
-- command-start snapshot that can otherwise let an UPDATE see a concurrent change
-- to the vehicle row without seeing the concurrently inserted blocker rows.

CREATE OR REPLACE FUNCTION lock_vehicle_for_blocking_defect()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.is_blocking IS DISTINCT FROM true OR NEW.resolved_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT status
    INTO v_status
  FROM vehicles
  WHERE id = NEW.vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_safety_evidence_conflict: vehicle not found'
      USING ERRCODE = '23503';
  END IF;

  -- Safety evidence that arrives after a successful return-to-service must
  -- immediately restore the operational restriction. Never revive terminal
  -- statuses into maintenance.
  IF v_status NOT IN ('out_of_service', 'written_off', 'decommissioned', 'maintenance') THEN
    UPDATE vehicles
    SET status = 'maintenance',
        updated_at = now()
    WHERE id = NEW.vehicle_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_vehicle_for_blocking_defect ON vehicle_defects;
CREATE TRIGGER trg_lock_vehicle_for_blocking_defect
BEFORE INSERT OR UPDATE OF is_blocking, resolved_at, vehicle_id
ON vehicle_defects
FOR EACH ROW
EXECUTE FUNCTION lock_vehicle_for_blocking_defect();

CREATE OR REPLACE FUNCTION lock_vehicle_for_safety_incident()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_vehicle_id uuid;
  v_status text;
BEGIN
  -- Only actual vehicle-safety evidence participates in this boundary. Unknown
  -- vehicle condition (NULL) is intentionally non-blocking unless damage or
  -- critical severity independently requires restriction.
  IF NOT (
    NEW.vehicle_damage IS TRUE
    OR NEW.vehicle_safe IS FALSE
    OR NEW.severity = 'critical'
  ) OR NEW.technical_clearance_status = 'cleared' THEN
    RETURN NEW;
  END IF;

  SELECT t.vehicle_id, v.status
    INTO v_vehicle_id, v_status
  FROM trips t
  JOIN vehicles v
    ON v.id = t.vehicle_id
   AND v.tenant_id = NEW.tenant_id
  WHERE t.id = NEW.trip_id
    AND t.tenant_id = NEW.tenant_id
  FOR UPDATE OF v;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_safety_evidence_conflict: trip vehicle not found in tenant'
      USING ERRCODE = '23503';
  END IF;

  IF v_status NOT IN ('out_of_service', 'written_off', 'decommissioned', 'maintenance') THEN
    UPDATE vehicles
    SET status = 'maintenance',
        updated_at = now()
    WHERE id = v_vehicle_id
      AND tenant_id = NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_vehicle_for_safety_incident ON trip_incidents;
CREATE TRIGGER trg_lock_vehicle_for_safety_incident
BEFORE INSERT OR UPDATE OF vehicle_damage, vehicle_safe, severity, technical_clearance_status, trip_id
ON trip_incidents
FOR EACH ROW
EXECUTE FUNCTION lock_vehicle_for_safety_incident();

CREATE OR REPLACE FUNCTION guard_vehicle_return_to_service()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_tenant_id uuid;
  v_has_blocker boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'available' OR OLD.status = 'available' THEN
    RETURN NEW;
  END IF;

  v_tenant_id := NEW.tenant_id;

  IF OLD.status IN ('written_off', 'decommissioned') THEN
    RETURN NULL;
  END IF;

  -- Because this is a VOLATILE PL/pgSQL trigger, the statements below execute
  -- through SPI in read-write mode and obtain a fresh Read Committed snapshot
  -- after the vehicle-row wait. That is the critical recheck missing from a
  -- complex UPDATE predicate evaluated only at command start.
  SELECT EXISTS (
    SELECT 1
    FROM vehicle_defects d
    WHERE d.vehicle_id = NEW.id
      AND d.is_blocking = true
      AND d.resolved_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM trips t
    WHERE t.vehicle_id = NEW.id
      AND t.tenant_id = v_tenant_id
      AND t.status IN ('pending', 'in_progress', 'return_due', 'return_inspection', 'closure_review')
  ) OR EXISTS (
    SELECT 1
    FROM trip_incidents ti
    JOIN trips incident_trip
      ON incident_trip.id = ti.trip_id
     AND incident_trip.tenant_id = v_tenant_id
    WHERE incident_trip.vehicle_id = NEW.id
      AND ti.tenant_id = v_tenant_id
      AND (
        ti.vehicle_damage IS TRUE
        OR ti.vehicle_safe IS FALSE
        OR ti.severity = 'critical'
      )
      AND ti.technical_clearance_status <> 'cleared'
  )
  INTO v_has_blocker;

  IF v_has_blocker THEN
    -- Skip only the availability transition. Callers that use UPDATE ... RETURNING
    -- receive zero rows and keep their existing 409/release-pending behavior.
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_vehicle_return_to_service ON vehicles;
CREATE TRIGGER trg_guard_vehicle_return_to_service
BEFORE UPDATE OF status
ON vehicles
FOR EACH ROW
WHEN (NEW.status = 'available' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION guard_vehicle_return_to_service();
