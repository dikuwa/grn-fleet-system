-- Operational expense receipt files are uploaded before the expense row exists.
-- Track that pre-ledger evidence in the database so final trip closure cannot
-- race object storage and leave unaccounted or orphaned receipt evidence.

CREATE TABLE IF NOT EXISTS operational_expense_receipt_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES trips(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  file_key text NOT NULL,
  original_file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  uploaded_by_user_id text NOT NULL,
  expense_id uuid REFERENCES trip_expenses(id) ON DELETE SET NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operational_expense_receipt_staging_tenant_key
  ON operational_expense_receipt_staging (tenant_id, file_key);
CREATE INDEX IF NOT EXISTS idx_operational_expense_receipt_staging_trip
  ON operational_expense_receipt_staging (tenant_id, trip_id);
CREATE INDEX IF NOT EXISTS idx_operational_expense_receipt_staging_expense
  ON operational_expense_receipt_staging (expense_id);

-- Serialize every trip-linked staging mutation with the authoritative trip row.
-- If closure owns the row lock first, the receipt mutation waits and then sees
-- closed; if the upload owns it first, closure waits and its own trigger sees the
-- committed unconsumed evidence before allowing the closed transition.
CREATE OR REPLACE FUNCTION enforce_operational_expense_receipt_staging_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_id uuid;
  v_tenant_id uuid;
  v_trip_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_trip_id := OLD.trip_id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_trip_id := NEW.trip_id;
    v_tenant_id := NEW.tenant_id;
  END IF;

  IF v_trip_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT status
    INTO v_trip_status
  FROM trips
  WHERE id = v_trip_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closed_trip_expense_receipt_immutable: trip is no longer current'
      USING ERRCODE = '23514';
  END IF;

  IF v_trip_status = 'closed' THEN
    RAISE EXCEPTION 'closed_trip_expense_receipt_immutable:%', v_trip_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operational_expense_receipt_staging_lifecycle
  ON operational_expense_receipt_staging;
CREATE TRIGGER trg_operational_expense_receipt_staging_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON operational_expense_receipt_staging
FOR EACH ROW
EXECUTE FUNCTION enforce_operational_expense_receipt_staging_lifecycle();

-- The trip UPDATE itself owns the authoritative trip-row lock. A volatile
-- PL/pgSQL trigger query then observes currently committed staging evidence. This
-- completes the opposite side of the serialization contract with uploads.
CREATE OR REPLACE FUNCTION enforce_trip_closure_operational_expense_receipts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    IF EXISTS (
      SELECT 1
      FROM operational_expense_receipt_staging staged
      WHERE staged.trip_id = NEW.id
        AND staged.tenant_id = NEW.tenant_id
        AND staged.expense_id IS NULL
        AND staged.consumed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'trip_closure_lifecycle_conflict: unconsumed operational expense receipt evidence remains'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_closure_operational_expense_receipts ON trips;
CREATE TRIGGER trg_trip_closure_operational_expense_receipts
BEFORE UPDATE OF status ON trips
FOR EACH ROW
EXECUTE FUNCTION enforce_trip_closure_operational_expense_receipts();

-- Consume staged evidence automatically when its operational expense commits.
-- This keeps the expense API backward-compatible while making tracked uploads
-- authoritative without requiring a second client-side finalize request.
CREATE OR REPLACE FUNCTION consume_operational_expense_receipt_staging()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
    AND staged.trip_id IS NOT DISTINCT FROM NEW.trip_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consume_operational_expense_receipt_staging ON trip_expenses;
CREATE TRIGGER trg_consume_operational_expense_receipt_staging
AFTER INSERT OR UPDATE OF receipt_key ON trip_expenses
FOR EACH ROW
EXECUTE FUNCTION consume_operational_expense_receipt_staging();
