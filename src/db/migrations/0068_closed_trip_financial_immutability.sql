-- A closed trip is a reconciled financial boundary. Fuel/expense rows linked to
-- that trip must not be inserted, edited or deleted afterwards, otherwise the
-- closure totals and generated completion documents become stale.

CREATE OR REPLACE FUNCTION prevent_closed_trip_financial_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_trip_id uuid;
  target_status text;
BEGIN
  target_trip_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.trip_id ELSE NEW.trip_id END;

  -- Vehicle-only fuel transactions are outside a trip reconciliation boundary.
  IF target_trip_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT status INTO target_status
  FROM trips
  WHERE id = target_trip_id;

  IF target_status = 'closed' THEN
    RAISE EXCEPTION 'closed_trip_financial_immutable:%', target_trip_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_closed_trip_fuel ON fuel_transactions;
CREATE TRIGGER trg_freeze_closed_trip_fuel
BEFORE INSERT OR UPDATE OR DELETE ON fuel_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_closed_trip_financial_mutation();

DROP TRIGGER IF EXISTS trg_freeze_closed_trip_expenses ON trip_expenses;
CREATE TRIGGER trg_freeze_closed_trip_expenses
BEFORE INSERT OR UPDATE OR DELETE ON trip_expenses
FOR EACH ROW EXECUTE FUNCTION prevent_closed_trip_financial_mutation();
