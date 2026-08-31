-- Preserve chronological trip-progress odometer evidence under concurrent writes.
--
-- The API validates a new reading against the nearest prior/next progress rows,
-- but those reads happen before the insert transaction. Concurrent online/offline
-- progress submissions can therefore both validate against stale neighbours.
-- Lock the authoritative trip + Trip Authority rows for each odometer-bearing
-- progress insert, then re-evaluate the committed timeline before accepting it.
--
-- Reuse the operations endpoint's refreshable lifecycle-conflict marker and
-- SQLSTATE 23505 so a concurrent sequence change returns HTTP 409 rather than 500.

CREATE OR REPLACE FUNCTION enforce_trip_progress_odometer_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_beginning_odometer integer;
  v_ending_odometer integer;
  v_previous_max integer;
  v_next_min integer;
BEGIN
  IF NEW.odometer_reading IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ta.beginning_odometer, ta.ending_odometer
    INTO v_beginning_odometer, v_ending_odometer
  FROM trips t
  JOIN trip_authorities ta
    ON ta.trip_id = t.id
   AND ta.tenant_id = t.tenant_id
  WHERE t.id = NEW.trip_id
    AND t.tenant_id = NEW.tenant_id
  FOR UPDATE OF t, ta;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: trip authority is no longer current for odometer validation'
      USING ERRCODE = '23505';
  END IF;

  IF v_beginning_odometer IS NOT NULL AND NEW.odometer_reading < v_beginning_odometer THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: odometer reading is below the authorised trip start'
      USING ERRCODE = '23505';
  END IF;

  IF v_ending_odometer IS NOT NULL AND NEW.odometer_reading > v_ending_odometer THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: odometer reading is above the recorded trip end'
      USING ERRCODE = '23505';
  END IF;

  SELECT MAX(tpe.odometer_reading)
    INTO v_previous_max
  FROM trip_progress_entries tpe
  WHERE tpe.trip_id = NEW.trip_id
    AND tpe.tenant_id = NEW.tenant_id
    AND tpe.odometer_reading IS NOT NULL
    AND tpe.occurred_at <= NEW.occurred_at;

  SELECT MIN(tpe.odometer_reading)
    INTO v_next_min
  FROM trip_progress_entries tpe
  WHERE tpe.trip_id = NEW.trip_id
    AND tpe.tenant_id = NEW.tenant_id
    AND tpe.odometer_reading IS NOT NULL
    AND tpe.occurred_at >= NEW.occurred_at;

  IF v_previous_max IS NOT NULL AND NEW.odometer_reading < v_previous_max THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: odometer timeline advanced while this progress update was being saved'
      USING ERRCODE = '23505';
  END IF;

  IF v_next_min IS NOT NULL AND NEW.odometer_reading > v_next_min THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: odometer timeline changed before this earlier progress update was saved'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_trip_progress_odometer_sequence ON trip_progress_entries;
CREATE TRIGGER trg_enforce_trip_progress_odometer_sequence
BEFORE INSERT ON trip_progress_entries
FOR EACH ROW
EXECUTE FUNCTION enforce_trip_progress_odometer_sequence();
