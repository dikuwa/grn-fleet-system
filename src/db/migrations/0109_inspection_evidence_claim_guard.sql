CREATE TABLE IF NOT EXISTS inspection_evidence_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_key text NOT NULL UNIQUE,
  uploaded_by_user_id text NOT NULL,
  original_file_name text,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  sha256 text NOT NULL,
  claimed_inspection_id uuid REFERENCES vehicle_inspections(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_inspection_evidence_claim_pair CHECK (
    (claimed_inspection_id IS NULL AND claimed_at IS NULL)
    OR (claimed_inspection_id IS NOT NULL AND claimed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_inspection_evidence_uploads_tenant_unclaimed
  ON inspection_evidence_uploads (tenant_id, created_at)
  WHERE claimed_inspection_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inspection_evidence_uploads_claimed_inspection
  ON inspection_evidence_uploads (claimed_inspection_id)
  WHERE claimed_inspection_id IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_official_inspection_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id uuid;
  v_inspector_user_id text;
  v_claimed_key text;
BEGIN
  SELECT vi.tenant_id, vi.inspector_user_id
    INTO v_tenant_id, v_inspector_user_id
  FROM vehicle_inspections vi
  WHERE vi.id = NEW.inspection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection_evidence_claim_conflict: official inspection is no longer available'
      USING ERRCODE = '23514';
  END IF;

  UPDATE inspection_evidence_uploads ieu
  SET claimed_inspection_id = NEW.inspection_id,
      claimed_at = now()
  WHERE ieu.tenant_id = v_tenant_id
    AND ieu.file_key = NEW.file_key
    AND ieu.uploaded_by_user_id = v_inspector_user_id
    AND ieu.claimed_inspection_id IS NULL
  RETURNING ieu.file_key INTO v_claimed_key;

  IF v_claimed_key IS NULL THEN
    RAISE EXCEPTION 'inspection_evidence_claim_conflict: inspection photo was not uploaded by this inspector or has already been claimed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_claim_official_inspection_evidence ON inspection_photos;
CREATE TRIGGER trg_claim_official_inspection_evidence
BEFORE INSERT ON inspection_photos
FOR EACH ROW
EXECUTE FUNCTION claim_official_inspection_evidence();
