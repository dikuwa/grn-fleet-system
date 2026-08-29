-- Trip expenses may be captured during the active journey and closure review,
-- but a preflight-only status check can lose a race with final closure.
-- Serialize each fresh expense INSERT with the authoritative tenant-scoped trip
-- row so an expense either commits before closure (and is then reconciled by the
-- closure gate) or is rejected after the trip has left the allowed lifecycle.
--
-- SQLSTATE 23505 intentionally reuses the operations endpoint's existing 409
-- conflict path. Committed offline expense retries are resolved by client_sync_id
-- before a fresh INSERT reaches this trigger.

CREATE OR REPLACE FUNCTION enforce_trip_expense_active_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
BEGIN
  SELECT t.status
    INTO v_trip_status
  FROM trips t
  WHERE t.id = NEW.trip_id
    AND t.tenant_id = NEW.tenant_id
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_expense_lifecycle_conflict: trip is no longer current for this tenant'
      USING ERRCODE = '23505';
  END IF;

  IF v_trip_status NOT IN ('in_progress', 'return_due', 'closure_review') THEN
    RAISE EXCEPTION 'trip_expense_lifecycle_conflict: trip is no longer open for expense capture'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_trip_expense_active_lifecycle ON trip_expenses;
CREATE TRIGGER trg_enforce_trip_expense_active_lifecycle
BEFORE INSERT ON trip_expenses
FOR EACH ROW
EXECUTE FUNCTION enforce_trip_expense_active_lifecycle();
