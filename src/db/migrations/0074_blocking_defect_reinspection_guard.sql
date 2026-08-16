-- A new blocking safety defect discovered after a vehicle has already passed
-- departure inspection invalidates that release boundary. Resolving the defect
-- does not resurrect the old inspection: a fresh official departure inspection
-- must establish that the repaired/current vehicle is safe before a Trip
-- Authority can be formally issued or the vehicle physically released.
--
-- This trigger also increments the canonical Trip Authority document version so
-- any previously issued generated PDF immediately becomes stale. The normal
-- inspection -> draft refresh -> formal issue lifecycle then creates the revised
-- official version without rewriting historical documents.

CREATE OR REPLACE FUNCTION invalidate_departure_release_on_blocking_defect()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act when a defect first becomes blocking. Ordinary edits/resolution of
  -- an already-blocking defect must not repeatedly manufacture authority versions.
  IF NEW.is_blocking IS DISTINCT FROM TRUE
     OR (TG_OP = 'UPDATE' AND OLD.is_blocking IS TRUE) THEN
    RETURN NEW;
  END IF;

  UPDATE trip_authorities ta
  SET status = 'awaiting_pre_trip_inspection',
      beginning_odometer = NULL,
      version = ta.version + 1,
      document_version = ta.document_version + 1,
      updated_at = CURRENT_TIMESTAMP
  FROM trips t
  WHERE t.id = ta.trip_id
    AND t.vehicle_id = NEW.vehicle_id
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
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blocking_defect_requires_reinspection ON vehicle_defects;
CREATE TRIGGER trg_blocking_defect_requires_reinspection
AFTER INSERT OR UPDATE OF is_blocking ON vehicle_defects
FOR EACH ROW
EXECUTE FUNCTION invalidate_departure_release_on_blocking_defect();
