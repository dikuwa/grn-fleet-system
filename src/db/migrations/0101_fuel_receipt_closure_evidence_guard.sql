-- Fuel receipt images, OCR data and review state are evidence supporting a
-- trip-linked fuel transaction. Once final trip closure commits, that evidence
-- must not be added, changed, removed or reassigned. Serialize receipt mutation
-- with the authoritative trip row so receipt changes cannot race closure.
--
-- Fuel receipts attached to transactions that are not linked to a trip remain
-- unaffected. Existing terminal-review immutability remains enforced separately.

CREATE OR REPLACE FUNCTION enforce_fuel_receipt_closure_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction_id uuid;
  v_tenant_id uuid;
  v_trip_id uuid;
  v_trip_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_transaction_id := OLD.transaction_id;
    v_tenant_id := OLD.tenant_id;

    SELECT ft.trip_id
      INTO v_trip_id
    FROM fuel_transactions ft
    JOIN vehicles v ON v.id = ft.vehicle_id
    WHERE ft.id = v_transaction_id
      AND (v_tenant_id IS NULL OR v.tenant_id = v_tenant_id);

    IF v_trip_id IS NOT NULL THEN
      SELECT t.status
        INTO v_trip_status
      FROM trips t
      WHERE t.id = v_trip_id
        AND (v_tenant_id IS NULL OR t.tenant_id = v_tenant_id)
      FOR UPDATE OF t;

      IF v_trip_status = 'closed' THEN
        RAISE EXCEPTION 'closed_trip_receipt_immutable:%', v_trip_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_transaction_id := NEW.transaction_id;
    v_tenant_id := NEW.tenant_id;
    v_trip_id := NULL;
    v_trip_status := NULL;

    SELECT ft.trip_id
      INTO v_trip_id
    FROM fuel_transactions ft
    JOIN vehicles v ON v.id = ft.vehicle_id
    WHERE ft.id = v_transaction_id
      AND (v_tenant_id IS NULL OR v.tenant_id = v_tenant_id);

    IF v_trip_id IS NOT NULL THEN
      SELECT t.status
        INTO v_trip_status
      FROM trips t
      WHERE t.id = v_trip_id
        AND (v_tenant_id IS NULL OR t.tenant_id = v_tenant_id)
      FOR UPDATE OF t;

      IF v_trip_status = 'closed' THEN
        RAISE EXCEPTION 'closed_trip_receipt_immutable:%', v_trip_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fuel_receipt_closure_evidence ON fuel_receipts;
CREATE TRIGGER trg_fuel_receipt_closure_evidence
BEFORE INSERT OR UPDATE OR DELETE ON fuel_receipts
FOR EACH ROW
EXECUTE FUNCTION enforce_fuel_receipt_closure_evidence();
