-- Journey progress is valid only while the trip is actively executing.
-- The API preflights this state, but a return/closure transition can win after
-- that read and before the progress transaction. Lock the authoritative trip
-- and Trip Authority rows at the database boundary so the progress INSERT is
-- serialized with lifecycle transitions.
--
-- SQLSTATE 23505 is intentional here: the operations endpoint already maps
-- transaction conflicts with this code to HTTP 409. Existing committed offline
-- rows are recovered by client_sync_id before a new INSERT reaches this trigger.

CREATE OR REPLACE FUNCTION enforce_trip_progress_active_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
  v_authority_status text;
BEGIN
  SELECT t.status, ta.status
    INTO v_trip_status, v_authority_status
  FROM trips t
  JOIN trip_authorities ta
    ON ta.trip_id = t.id
   AND ta.tenant_id = t.tenant_id
  WHERE t.id = NEW.trip_id
    AND t.tenant_id = NEW.tenant_id
  FOR UPDATE OF t, ta;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: trip authority is no longer current'
      USING ERRCODE = '23505';
  END IF;

  IF v_trip_status NOT IN ('in_progress', 'return_due') THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: trip is no longer active for journey updates'
      USING ERRCODE = '23505';
  END IF;

  IF v_authority_status = 'incident_reported' THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: journey progress is on hold after a critical safety incident'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_trip_progress_active_lifecycle ON trip_progress_entries;
CREATE TRIGGER trg_enforce_trip_progress_active_lifecycle
BEFORE INSERT ON trip_progress_entries
FOR EACH ROW
EXECUTE FUNCTION enforce_trip_progress_active_lifecycle();
