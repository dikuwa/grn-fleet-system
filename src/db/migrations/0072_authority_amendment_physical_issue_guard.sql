-- A material Trip Authority amendment must not become effective in the narrow
-- custody window after a vehicle has been physically issued but before actual
-- departure. At that point keys/vehicle custody were handed over against the
-- already-issued authority. Silently changing route, dates, purpose or special
-- authority would bypass revised acceptance, inspection and document issue.
--
-- Vehicle replacement owns its own explicit issue-reset lifecycle, so this
-- trigger applies to the generic authority-amendment types handled by the
-- authority amendments endpoint.

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

  -- Resolve the immutable authority→trip relationship first, then acquire
  -- lifecycle locks in trip→authority order. The official-inspection guard uses
  -- the same order, avoiding an unnecessary opposite-lock deadlock class.
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

  IF v_trip_status = 'pending' AND v_trip_issued_at IS NOT NULL THEN
    RAISE EXCEPTION 'authority_amendment_lifecycle_conflict: physical vehicle issue must be reversed or the trip cancelled before a pre-departure authority amendment can be approved'
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
