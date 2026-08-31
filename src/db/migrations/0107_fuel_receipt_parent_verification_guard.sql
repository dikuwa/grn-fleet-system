-- Keep the parent fuel transaction verification state authoritative to the
-- committed set of receipt evidence.
--
-- Receipt review historically derives the parent state in the API before the
-- atomic mutation. Concurrent sibling reviews can therefore both observe stale
-- pending evidence and leave the parent flagged after every receipt is verified.
-- A newly inserted pending receipt can likewise coexist with a previously
-- verified parent.
--
-- A deferred constraint trigger is intentional here: it runs after all receipt
-- and parent mutations in the transaction, serializes on fuel_transactions, and
-- recomputes from the final receipt state visible to that transaction. Competing
-- receipt transactions serialize on the same parent row, so the last committer
-- always sees receipt evidence committed by the earlier transaction.

CREATE OR REPLACE FUNCTION sync_fuel_transaction_receipt_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_transaction_id uuid;
  v_total integer;
  v_pending integer;
  v_rejected integer;
  v_latest_verifier text;
  v_current_state text;
  v_current_notes text;
BEGIN
  -- UPDATE can theoretically re-parent a receipt. Recompute OLD first, then NEW.
  -- The API does not currently expose re-parenting, but handling it here keeps
  -- the database boundary correct if that changes later.
  FOR v_transaction_id IN
    SELECT DISTINCT transaction_id
    FROM (
      SELECT CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.transaction_id END AS transaction_id
      UNION ALL
      SELECT CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.transaction_id END AS transaction_id
    ) affected
    WHERE transaction_id IS NOT NULL
    ORDER BY transaction_id
  LOOP
    -- Authoritative serialization point shared by receipt review, receipt upload,
    -- and direct fuel-transaction review.
    SELECT anomaly_state, anomaly_notes
      INTO v_current_state, v_current_notes
    FROM fuel_transactions
    WHERE id = v_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT
      count(*)::integer,
      count(*) FILTER (
        WHERE is_verified = false
          AND ocr_status <> 'rejected'
      )::integer,
      count(*) FILTER (
        WHERE is_verified = false
          AND ocr_status = 'rejected'
      )::integer
      INTO v_total, v_pending, v_rejected
    FROM fuel_receipts
    WHERE transaction_id = v_transaction_id;

    SELECT verified_by_user_id
      INTO v_latest_verifier
    FROM fuel_receipts
    WHERE transaction_id = v_transaction_id
      AND is_verified = true
      AND verified_by_user_id IS NOT NULL
    ORDER BY verified_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    IF v_total = 0 THEN
      UPDATE fuel_transactions
      SET is_verified = false,
          verified_by_user_id = NULL,
          anomaly_state = 'flagged',
          anomaly_notes = 'No linked receipt evidence remains after receipt mutation',
          updated_at = now()
      WHERE id = v_transaction_id;
    ELSIF v_rejected > 0 THEN
      UPDATE fuel_transactions
      SET is_verified = false,
          verified_by_user_id = NULL,
          anomaly_state = 'rejected',
          anomaly_notes = CASE
            WHEN v_current_state = 'rejected' AND v_current_notes IS NOT NULL THEN v_current_notes
            ELSE v_rejected || ' linked receipt' || CASE WHEN v_rejected = 1 THEN ' remains' ELSE 's remain' END || ' rejected and require resolution'
          END,
          updated_at = now()
      WHERE id = v_transaction_id;
    ELSIF v_pending > 0 THEN
      UPDATE fuel_transactions
      SET is_verified = false,
          verified_by_user_id = NULL,
          anomaly_state = 'flagged',
          anomaly_notes = CASE
            WHEN v_current_state = 'flagged' AND v_current_notes IS NOT NULL THEN v_current_notes
            ELSE 'Awaiting verification of ' || v_pending || ' linked receipt' || CASE WHEN v_pending = 1 THEN '' ELSE 's' END
          END,
          updated_at = now()
      WHERE id = v_transaction_id;
    ELSE
      UPDATE fuel_transactions
      SET is_verified = true,
          verified_by_user_id = v_latest_verifier,
          anomaly_state = 'verified',
          anomaly_notes = NULL,
          updated_at = now()
      WHERE id = v_transaction_id;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_fuel_transaction_receipt_verification ON fuel_receipts;
CREATE CONSTRAINT TRIGGER trg_sync_fuel_transaction_receipt_verification
AFTER INSERT OR UPDATE OR DELETE ON fuel_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sync_fuel_transaction_receipt_verification();
