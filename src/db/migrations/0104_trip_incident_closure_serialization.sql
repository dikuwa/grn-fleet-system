-- Serialize fresh trip-incident evidence with final closure while preserving the
-- deliberately narrow late-offline recovery path for already-closed trips.
--
-- Closure claims the parent trip row first. Incident creation must participate
-- in the same lock order so only one side can observe the return/closure state
-- first. If the incident wins, existing reconciliation invalidation is retained
-- and closure must re-check it. If closure wins, the incident remains valid
-- archival evidence but stale application state must not reopen reconciliation.

CREATE OR REPLACE FUNCTION lock_trip_for_incident_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
BEGIN
  SELECT status
    INTO v_trip_status
  FROM trips
  WHERE id = NEW.trip_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_incident_lifecycle_conflict: trip not found in tenant'
      USING ERRCODE = '23503';
  END IF;

  -- Do not reject closed trips here. A bounded offline incident captured during
  -- the real journey may intentionally sync after closure; the application
  -- remains responsible for that occurrence/draft-window policy.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_trip_for_incident_evidence ON trip_incidents;
CREATE TRIGGER trg_lock_trip_for_incident_evidence
BEFORE INSERT
ON trip_incidents
FOR EACH ROW
EXECUTE FUNCTION lock_trip_for_incident_evidence();

-- createIncident() may have preloaded closure_review immediately before final
-- closure won the trip lock. Its legacy authority mutation carries a very
-- specific late-incident marker. On an already-closed trip, preserve the signed
-- and reconciled return declaration instead of allowing that stale mutation to
-- clear reconciledAt after closure.
CREATE OR REPLACE FUNCTION preserve_closed_trip_return_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_status text;
  v_old_reconciled_at text;
  v_new_reconciled_at text;
  v_late_incident_reconciliation boolean := false;
BEGIN
  IF NEW.data IS NOT DISTINCT FROM OLD.data THEN
    RETURN NEW;
  END IF;

  v_old_reconciled_at := NULLIF(
    OLD.data -> 'returnDeclaration' ->> 'reconciledAt',
    ''
  );
  v_new_reconciled_at := NULLIF(
    NEW.data -> 'returnDeclaration' ->> 'reconciledAt',
    ''
  );
  v_late_incident_reconciliation := COALESCE(
    (NEW.data -> 'returnDeclaration' ->> 'lateIncidentRequiresReconciliation')::boolean,
    false
  );

  IF v_old_reconciled_at IS NULL
     OR v_new_reconciled_at IS NOT NULL
     OR NOT v_late_incident_reconciliation THEN
    RETURN NEW;
  END IF;

  SELECT status
    INTO v_trip_status
  FROM trips
  WHERE id = NEW.trip_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF v_trip_status = 'closed' THEN
    NEW.data := jsonb_set(
      COALESCE(NEW.data, '{}'::jsonb),
      '{returnDeclaration}',
      COALESCE(OLD.data -> 'returnDeclaration', '{}'::jsonb),
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_closed_trip_return_reconciliation ON trip_authorities;
CREATE TRIGGER trg_preserve_closed_trip_return_reconciliation
BEFORE UPDATE OF data
ON trip_authorities
FOR EACH ROW
EXECUTE FUNCTION preserve_closed_trip_return_reconciliation();

-- Keep immutable audit evidence truthful when the closure-first branch converts
-- a stale reconciliation-invalidating mutation into normal post-close archival
-- evidence. This runs before the audit row is inserted, so no audit UPDATE is
-- needed and the existing immutable/hash-chain policy remains intact.
CREATE OR REPLACE FUNCTION correct_closed_late_incident_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_trip_id uuid;
  v_trip_status text;
BEGIN
  IF NEW.event_type <> 'incident_created'
     OR COALESCE((NEW."after" ->> 'returnReconciliationInvalidated')::boolean, false) = false
     OR NULLIF(NEW."after" ->> 'tripId', '') IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_trip_id := (NEW."after" ->> 'tripId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;

  SELECT status
    INTO v_trip_status
  FROM trips
  WHERE id = v_trip_id
    AND tenant_id = NEW.tenant_id;

  IF v_trip_status = 'closed' THEN
    NEW."after" := jsonb_set(
      COALESCE(NEW."after", '{}'::jsonb),
      '{returnReconciliationInvalidated}',
      'false'::jsonb,
      true
    ) || jsonb_build_object('lateIncidentArchivedAfterClosure', true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_correct_closed_late_incident_audit ON audit_events;
CREATE TRIGGER trg_correct_closed_late_incident_audit
BEFORE INSERT
ON audit_events
FOR EACH ROW
EXECUTE FUNCTION correct_closed_late_incident_audit();
