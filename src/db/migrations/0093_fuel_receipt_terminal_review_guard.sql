-- Prevent stale uploader/driver actions from reopening a receipt after Transport
-- Office has completed its terminal review. API guards improve UX, while this
-- database guard closes the concurrent read/write race at the storage boundary.

CREATE OR REPLACE FUNCTION "guard_fuel_receipt_terminal_review"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."ocr_status" IN ('verified', 'rejected')
     AND NEW."ocr_status" IS DISTINCT FROM OLD."ocr_status" THEN
    RAISE EXCEPTION 'Fuel receipt terminal review state % cannot transition to %',
      OLD."ocr_status", NEW."ocr_status"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_fuel_receipts_terminal_review_guard" ON "fuel_receipts";
CREATE TRIGGER "trg_fuel_receipts_terminal_review_guard"
BEFORE UPDATE OF "ocr_status"
ON "fuel_receipts"
FOR EACH ROW
EXECUTE FUNCTION "guard_fuel_receipt_terminal_review"();
