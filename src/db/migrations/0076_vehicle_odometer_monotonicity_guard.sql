-- Serialize immutable odometer evidence per vehicle and reject regressions.
--
-- Application routes already compare a submitted reading with vehicles.current_odometer,
-- but that preflight is not sufficient under concurrency: another inspection, fuel or
-- maintenance write may advance the odometer before the stale event is inserted.
-- Locking the vehicle row makes every odometer-event insert for that vehicle serialize,
-- while checking both the current vehicle value and the highest immutable event protects
-- paths that append evidence before updating vehicles.current_odometer.

CREATE OR REPLACE FUNCTION enforce_vehicle_odometer_event_monotonicity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_value integer;
  highest_event_value integer;
  minimum_allowed integer;
BEGIN
  SELECT v.current_odometer
    INTO current_value
    FROM vehicles v
   WHERE v.id = NEW.vehicle_id
   FOR UPDATE;

  -- Let the foreign-key constraint own the missing-vehicle error path.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(voe.odometer_value), 0)
    INTO highest_event_value
    FROM vehicle_odometer_events voe
   WHERE voe.vehicle_id = NEW.vehicle_id;

  minimum_allowed := GREATEST(COALESCE(current_value, 0), COALESCE(highest_event_value, 0));

  IF NEW.odometer_value < minimum_allowed THEN
    RAISE EXCEPTION 'vehicle_odometer_regression: submitted %, minimum allowed %',
      NEW.odometer_value,
      minimum_allowed
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_odometer_event_monotonicity
  ON vehicle_odometer_events;

CREATE TRIGGER trg_vehicle_odometer_event_monotonicity
BEFORE INSERT ON vehicle_odometer_events
FOR EACH ROW
EXECUTE FUNCTION enforce_vehicle_odometer_event_monotonicity();
