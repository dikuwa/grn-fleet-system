-- A closed trip is a reconciled financial boundary. Fuel/expense rows linked to
-- that trip must not be inserted, edited, deleted or reassigned afterwards,
-- otherwise the closure totals and generated completion documents become stale.

CREATE OR REPLACE FUNCTION prevent_closed_trip_financial_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_trip_status text;
  new_trip_status text;
BEGIN
  -- UPDATE must protect both sides of the association. Checking only NEW.trip_id
  -- would allow a reconciled row to escape immutability by being reassigned from
  -- a closed trip to an open trip (or to NULL).
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.trip_id IS NOT NULL THEN
    SELECT status INTO old_trip_status
    FROM trips
    WHERE id = OLD.trip_id;

    IF old_trip_status = 'closed' THEN
      RAISE EXCEPTION 'closed_trip_financial_immutable:%', OLD.trip_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.trip_id IS NOT NULL THEN
    SELECT status INTO new_trip_status
    FROM trips
    WHERE id = NEW.trip_id;

    IF new_trip_status = 'closed' THEN
      RAISE EXCEPTION 'closed_trip_financial_immutable:%', NEW.trip_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
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
