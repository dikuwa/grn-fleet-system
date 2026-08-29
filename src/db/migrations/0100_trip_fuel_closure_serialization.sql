-- Trip-linked fuel creation must serialize with final trip closure.
-- Existing closed-trip financial immutability rejects writes after closure, but
-- its status lookup is intentionally broad and does not lock the trip row. This
-- trigger adds the missing row lock for fresh INSERTs only, so either:
--   1. fuel commits first and closure subsequently sees/reconciles it, or
--   2. closure commits first and the fuel insert resumes against a closed trip
--      and is rejected by the existing conflict contract.
--
-- Fuel transactions not linked to a trip remain unaffected.

CREATE OR REPLACE FUNCTION serialize_trip_fuel_with_closure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
BEGIN
  IF NEW.trip_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.status
    INTO v_trip_status
  FROM trips t
  WHERE t.id = NEW.trip_id
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closed_trip_financial_immutable:%', NEW.trip_id
      USING ERRCODE = '23514';
  END IF;

  IF v_trip_status = 'closed' THEN
    RAISE EXCEPTION 'closed_trip_financial_immutable:%', NEW.trip_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_serialize_trip_fuel_with_closure ON fuel_transactions;
CREATE TRIGGER trg_serialize_trip_fuel_with_closure
BEFORE INSERT ON fuel_transactions
FOR EACH ROW
EXECUTE FUNCTION serialize_trip_fuel_with_closure();
