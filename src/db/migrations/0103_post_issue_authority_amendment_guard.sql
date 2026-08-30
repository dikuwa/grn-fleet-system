-- Generic material Trip Authority amendments use the pre-departure revised-
-- authority acceptance lifecycle. Once physical issue or departure has happened,
-- approving one of these amendments must not rewrite the live authority row that
-- PDF generation and public QR verification render.
--
-- Preserve migration 0072's trip -> authority lock order so concurrent Issue,
-- departure, inspection, and amendment writers serialize on the same lifecycle
-- rows. Dedicated vehicle/driver replacement lifecycles remain out of scope.

CREATE OR REPLACE FUNCTION guard_trip_authority_amendment_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_id uuid;
  v_trip_status text;
  v_trip_issued_at timestamptz;
  v_authority_status text;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  IF NEW.amendment_type NOT IN (
    'date_extension',
    'route_change',
    'purpose_clarification',
    'special_authorisation'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT trip_id
    INTO v_trip_id
  FROM trip_authorities
  WHERE id = NEW.authority_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authority_amendment_lifecycle_conflict: authority not found'
      USING ERRCODE = '23514';
  END IF;

  SELECT status, issued_at
    INTO v_trip_status, v_trip_issued_at
  FROM trips
  WHERE id = v_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authority_amendment_lifecycle_conflict: trip not found'
      USING ERRCODE = '23514';
  END IF;

  SELECT status
    INTO v_authority_status
  FROM trip_authorities
  WHERE id = NEW.authority_id
    AND trip_id = v_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'authority_amendment_lifecycle_conflict: authority changed while approval was being recorded'
      USING ERRCODE = '23514';
  END IF;

  IF v_trip_status IN ('closed', 'cancelled')
     OR v_authority_status IN ('closed', 'cancelled', 'expired', 'superseded') THEN
    RAISE EXCEPTION 'authority_amendment_lifecycle_conflict: terminal authority cannot be amended'
      USING ERRCODE = '23514';
  END IF;

  -- Generic material amendments only have a driver re-acceptance + fresh
  -- departure-inspection protocol while the trip is pending and not yet issued.
  -- After physical issue/departure, approving one would mutate the same live
  -- authority row used by downloads and public verification without a matching
  -- driver acknowledgement or re-issue event.
  IF v_trip_issued_at IS NOT NULL OR v_trip_status <> 'pending' THEN
    RAISE EXCEPTION 'authority_amendment_lifecycle_conflict: material Trip Authority amendments cannot be approved after physical issue or departure'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_trip_authority_amendment_approval ON trip_amendments;
CREATE TRIGGER trg_guard_trip_authority_amendment_approval
BEFORE UPDATE OF status ON trip_amendments
FOR EACH ROW
EXECUTE FUNCTION guard_trip_authority_amendment_approval();
