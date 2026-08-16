-- Physical vehicle issue must be backed by the formally issued Trip Authority
-- snapshot for the *current canonical authority version*. Merely having some
-- historical issued authority in the family is insufficient: post-issue
-- amendments can advance trip_authorities.document_version while a draft
-- refresh fails or is still awaiting formal issue.

CREATE OR REPLACE FUNCTION guard_trip_physical_issue_current_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_authority_document_version integer;
  v_latest_document_id uuid;
  v_latest_document_status text;
  v_latest_snapshot_authority_version integer;
BEGIN
  IF OLD.issued_at IS NOT NULL OR NEW.issued_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ta.document_version
    INTO v_authority_document_version
  FROM trip_authorities ta
  WHERE ta.trip_id = NEW.id
    AND ta.tenant_id = NEW.tenant_id
    AND ta.allocation_id = NEW.allocation_id
    AND ta.status = 'ready_for_departure'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_issue_authority_conflict: current ready Trip Authority not found'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    gd.id,
    gd.status,
    CASE
      WHEN (gd.snapshot_data #>> '{renderData,documentVersion}') ~ '^[0-9]+$'
        THEN (gd.snapshot_data #>> '{renderData,documentVersion}')::integer
      ELSE NULL
    END
  INTO
    v_latest_document_id,
    v_latest_document_status,
    v_latest_snapshot_authority_version
  FROM generated_documents gd
  WHERE gd.tenant_id = NEW.tenant_id
    AND gd.entity_type = 'vehicle_allocation'
    AND gd.entity_id = NEW.allocation_id
    AND gd.document_type = 'trip_authority'
  ORDER BY gd.document_version DESC, gd.created_at DESC, gd.id DESC
  LIMIT 1;

  IF v_latest_document_id IS NULL THEN
    RAISE EXCEPTION 'trip_issue_authority_conflict: Trip Authority document missing'
      USING ERRCODE = '23514';
  END IF;

  IF v_latest_document_status <> 'issued' THEN
    RAISE EXCEPTION 'trip_issue_authority_conflict: latest Trip Authority document is %', v_latest_document_status
      USING ERRCODE = '23514';
  END IF;

  IF v_latest_snapshot_authority_version IS DISTINCT FROM v_authority_document_version THEN
    RAISE EXCEPTION 'trip_issue_authority_conflict: issued Trip Authority snapshot version % does not match current authority version %',
      COALESCE(v_latest_snapshot_authority_version::text, 'missing'),
      v_authority_document_version::text
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_physical_issue_current_authority ON trips;
CREATE TRIGGER trg_trip_physical_issue_current_authority
BEFORE UPDATE OF issued_at ON trips
FOR EACH ROW
WHEN (OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL)
EXECUTE FUNCTION guard_trip_physical_issue_current_authority();
