-- Authoritative active-trip evidence claims.
-- Incident attachments must originate from authenticated tenant uploads and are
-- single-use business evidence. Expense receipt references must consume their
-- existing staging row instead of accepting arbitrary object keys. Progress
-- attachments are not currently exposed by the product UI, so the dormant raw
-- API field is rejected until it has an authoritative staging path.

CREATE TABLE IF NOT EXISTS active_trip_evidence_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evidence_kind text NOT NULL,
  file_key text NOT NULL,
  uploaded_by_user_id text NOT NULL,
  original_file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  sha256 text NOT NULL,
  claimed_trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  claimed_entity_type text,
  claimed_entity_id uuid,
  claimed_sync_id text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_active_trip_evidence_claim_pair CHECK (
    (claimed_entity_id IS NULL AND claimed_at IS NULL AND claimed_entity_type IS NULL)
    OR
    (claimed_entity_id IS NOT NULL AND claimed_at IS NOT NULL AND claimed_entity_type IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_trip_evidence_uploads_tenant_key
  ON active_trip_evidence_uploads (tenant_id, file_key);
CREATE INDEX IF NOT EXISTS idx_active_trip_evidence_uploads_claim
  ON active_trip_evidence_uploads (tenant_id, claimed_entity_type, claimed_entity_id);
CREATE INDEX IF NOT EXISTS idx_active_trip_evidence_uploads_sync
  ON active_trip_evidence_uploads (tenant_id, claimed_sync_id)
  WHERE claimed_sync_id IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_trip_incident_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_key text;
  v_upload_id uuid;
  v_sha256 text;
  v_claimed_entity_id uuid;
  v_claimed_sync_id text;
  v_hashes jsonb := '{}'::jsonb;
  v_total integer;
  v_distinct integer;
BEGIN
  IF NEW.attachment_keys IS NULL THEN
    NEW.attachment_keys := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(NEW.attachment_keys) <> 'array' THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: incident attachment keys must be an array'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*), count(DISTINCT value)
    INTO v_total, v_distinct
  FROM jsonb_array_elements_text(NEW.attachment_keys);

  IF v_total <> v_distinct THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: duplicate incident attachment evidence is not allowed'
      USING ERRCODE = '23514';
  END IF;

  FOR v_key IN
    SELECT value
    FROM jsonb_array_elements_text(NEW.attachment_keys)
    ORDER BY value
  LOOP
    SELECT id, sha256, claimed_entity_id, claimed_sync_id
      INTO v_upload_id, v_sha256, v_claimed_entity_id, v_claimed_sync_id
    FROM active_trip_evidence_uploads
    WHERE tenant_id = NEW.tenant_id
      AND evidence_kind = 'trip_incident'
      AND file_key = v_key
      AND uploaded_by_user_id = NEW.reported_by_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'trip_progress_lifecycle_conflict: incident attachment evidence was not staged by this tenant user'
        USING ERRCODE = '23514';
    END IF;

    IF v_claimed_entity_id IS NULL THEN
      UPDATE active_trip_evidence_uploads
      SET claimed_trip_id = NEW.trip_id,
          claimed_entity_type = 'trip_incident',
          claimed_entity_id = NEW.id,
          claimed_sync_id = NEW.client_sync_id,
          claimed_at = now()
      WHERE id = v_upload_id;
    ELSIF v_claimed_entity_id = NEW.id THEN
      NULL;
    ELSIF NEW.client_sync_id IS NOT NULL
      AND v_claimed_sync_id IS NOT DISTINCT FROM NEW.client_sync_id THEN
      -- Concurrent retry of the same logical offline operation. Allow the row
      -- insert to continue to the existing tenant/clientSyncId unique guard so
      -- the application can recover the already-committed incident.
      NULL;
    ELSE
      RAISE EXCEPTION 'trip_progress_lifecycle_conflict: incident attachment evidence was already claimed'
        USING ERRCODE = '23514';
    END IF;

    v_hashes := v_hashes || jsonb_build_object(v_key, v_sha256);
  END LOOP;

  -- Never trust client-provided hashes. The authoritative digest is the one
  -- computed server-side at upload staging time.
  NEW.attachment_hashes := v_hashes;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_claim_trip_incident_evidence ON trip_incidents;
CREATE TRIGGER trg_claim_trip_incident_evidence
BEFORE INSERT ON trip_incidents
FOR EACH ROW
EXECUTE FUNCTION claim_trip_incident_evidence();

CREATE OR REPLACE FUNCTION reject_unstaged_trip_progress_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.attachment_key IS NOT NULL AND length(trim(NEW.attachment_key)) > 0 THEN
    RAISE EXCEPTION 'trip_progress_lifecycle_conflict: progress attachments require an authoritative staged upload path'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_unstaged_trip_progress_attachment ON trip_progress_entries;
CREATE TRIGGER trg_reject_unstaged_trip_progress_attachment
BEFORE INSERT OR UPDATE OF attachment_key ON trip_progress_entries
FOR EACH ROW
EXECUTE FUNCTION reject_unstaged_trip_progress_attachment();

-- Tighten the 0108 staging consumer: a non-null receipt key is authoritative
-- only if exactly one unconsumed staging row exists for the same tenant, trip,
-- vehicle and uploader. Raising from the AFTER trigger rolls the expense insert
-- back atomically when no staging claim exists.
CREATE OR REPLACE FUNCTION consume_operational_expense_receipt_staging()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_claimed integer;
BEGIN
  IF NEW.receipt_key IS NULL OR length(trim(NEW.receipt_key)) = 0 THEN
    RETURN NEW;
  END IF;

  UPDATE operational_expense_receipt_staging staged
  SET expense_id = NEW.id,
      consumed_at = now()
  WHERE staged.tenant_id = NEW.tenant_id
    AND staged.file_key = NEW.receipt_key
    AND staged.expense_id IS NULL
    AND staged.consumed_at IS NULL
    AND staged.vehicle_id = NEW.vehicle_id
    AND staged.trip_id IS NOT DISTINCT FROM NEW.trip_id
    AND staged.uploaded_by_user_id = NEW.entered_by_user_id;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed <> 1 THEN
    RAISE EXCEPTION 'trip_expense_lifecycle_conflict: receipt evidence was not staged by this tenant user or was already claimed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
