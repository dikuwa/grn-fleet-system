-- Keep closed-trip financial rows immutable during all ordinary application
-- work while allowing the separately authorised reset engine to delete them.
-- The reset engine sets this flag with set_config(..., true), so it exists only
-- inside the already approved, recovery-verified atomic reset transaction.

CREATE OR REPLACE FUNCTION prevent_closed_trip_financial_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_trip_status text;
  new_trip_status text;
BEGIN
  IF current_setting('govfleet.governed_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

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
