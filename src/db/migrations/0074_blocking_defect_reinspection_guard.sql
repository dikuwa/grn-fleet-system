-- A new blocking safety defect discovered after a vehicle has already passed
-- departure inspection invalidates that release boundary. Resolving the defect
-- does not resurrect the old inspection: a fresh official departure inspection
-- must establish that the repaired/current vehicle is safe before a Trip
-- Authority can be formally issued or the vehicle physically released.
--
-- The trigger deliberately serialises against the same canonical Trip Authority
-- row locked by the physical-issue guard. If a defect wins the race, issue sees
-- the invalidated authority and fails. If physical issue wins first but the trip
-- has not departed, the defect immediately recalls that issue: the historical
-- trip_issues row remains immutable, while current issue pointers are cleared.
-- This prevents keys/custody recorded against stale safety evidence from silently
-- authorising departure.

CREATE OR REPLACE FUNCTION invalidate_departure_release_on_blocking_defect()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip record;
BEGIN
  -- Only act when a defect first becomes blocking. Ordinary edits/resolution of
  -- an already-blocking defect must not repeatedly manufacture authority versions.
  IF NEW.is_blocking IS DISTINCT FROM TRUE
     OR (TG_OP = 'UPDATE' AND OLD.is_blocking IS TRUE) THEN
    RETURN NEW;
  END IF;

  FOR v_trip IN
    SELECT
      t.id AS trip_id,
      t.request_id,
      t.tenant_id,
      t.issued_at,
      ta.id AS authority_id,
      ta.status AS authority_status
    FROM trips t
    INNER JOIN trip_authorities ta
      ON ta.trip_id = t.id
     AND ta.tenant_id = t.tenant_id
    WHERE t.vehicle_id = NEW.vehicle_id
      AND t.status = 'pending'
      AND t.started_at IS NULL
      AND ta.status = 'ready_for_departure'
      AND EXISTS (
        SELECT 1
        FROM vehicle_inspections vi
        WHERE vi.tenant_id = t.tenant_id
          AND vi.trip_id = t.id
          AND vi.vehicle_id = NEW.vehicle_id
          AND vi.type = 'departure'
          AND vi.status = 'completed'
          AND vi.overall_pass = TRUE
          AND vi.created_at <= NEW.created_at
      )
    ORDER BY t.id
    FOR UPDATE OF t, ta
  LOOP
    UPDATE trip_authorities
    SET status = 'awaiting_pre_trip_inspection',
        beginning_odometer = NULL,
        version = version + 1,
        document_version = document_version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_trip.authority_id
      AND tenant_id = v_trip.tenant_id
      AND status = 'ready_for_departure';

    -- A defect discovered after physical issue but before actual departure is a
    -- safety recall, not a deletion of history. The existing trip_issues row is
    -- retained; only the current custody pointer is cleared so reinspection and
    -- a new physical issue are mandatory.
    IF v_trip.issued_at IS NOT NULL THEN
      UPDATE trips
      SET issued_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = v_trip.trip_id
        AND tenant_id = v_trip.tenant_id
        AND status = 'pending'
        AND started_at IS NULL;

      UPDATE external_driver_assignments
      SET issue_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = v_trip.tenant_id
        AND trip_id = v_trip.trip_id
        AND issue_id IS NOT NULL;

      UPDATE transport_requests
      SET status = 'authorised',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = v_trip.request_id
        AND tenant_id = v_trip.tenant_id
        AND status = 'vehicle_issued';
    END IF;
  END LOOP;

  UPDATE vehicles
  SET status = CASE
        WHEN status IN ('available', 'provisional', 'allocated', 'issued') THEN 'maintenance'
        ELSE status
      END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.vehicle_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blocking_defect_requires_reinspection ON vehicle_defects;
CREATE TRIGGER trg_blocking_defect_requires_reinspection
AFTER INSERT OR UPDATE OF is_blocking ON vehicle_defects
FOR EACH ROW
EXECUTE FUNCTION invalidate_departure_release_on_blocking_defect();
