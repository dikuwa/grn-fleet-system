-- Request routing origin is frozen once a request has been submitted.
-- Application routing already treats transport_requests.request_origin as the
-- authoritative historical origin. This database guard prevents correction,
-- resubmission, programme-link edits, or stale application code from silently
-- changing that governed origin after submission.

CREATE OR REPLACE FUNCTION preserve_submitted_transport_request_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.submitted_at IS NOT NULL OR OLD.status <> 'draft')
     AND NEW.request_origin IS DISTINCT FROM OLD.request_origin THEN
    NEW.request_origin := OLD.request_origin;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_preserve_submitted_transport_request_origin'
      AND tgrelid = 'transport_requests'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_preserve_submitted_transport_request_origin
      BEFORE UPDATE OF request_origin ON transport_requests
      FOR EACH ROW
      EXECUTE FUNCTION preserve_submitted_transport_request_origin();
  END IF;
END;
$$;

-- Some older correction code records a proposed requestOrigin change before
-- the guarded transport_requests UPDATE is committed. Keep the revision audit
-- truthful: if the persisted request origin is still the snapshot origin, the
-- revision did not change requestOrigin.
CREATE OR REPLACE FUNCTION normalize_request_revision_origin_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  persisted_origin text;
  snapshot_origin text;
BEGIN
  IF NEW.changed_fields IS NULL OR NOT (NEW.changed_fields ? 'requestOrigin') THEN
    RETURN NEW;
  END IF;

  SELECT request_origin
    INTO persisted_origin
    FROM transport_requests
   WHERE id = NEW.request_id;

  snapshot_origin := NEW.data -> 'request' ->> 'requestOrigin';

  IF persisted_origin IS NOT DISTINCT FROM snapshot_origin THEN
    NEW.changed_fields := jsonb_set(
      NEW.changed_fields,
      '{requestOrigin}',
      'false'::jsonb,
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_normalize_request_revision_origin_flag'
      AND tgrelid = 'request_revisions'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_normalize_request_revision_origin_flag
      BEFORE INSERT OR UPDATE OF changed_fields, data ON request_revisions
      FOR EACH ROW
      EXECUTE FUNCTION normalize_request_revision_origin_flag();
  END IF;
END;
$$;
