-- Return-time incident and outstanding-receipt declarations are durable Trip
-- Authority evidence. Closure must not silently ignore a positive declaration:
-- Transport Office must explicitly reconcile it, and the underlying evidence
-- must exist at the database boundary.

CREATE OR REPLACE FUNCTION enforce_trip_closure_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id uuid;
  v_request_id uuid;
  v_allocation_id uuid;
  v_vehicle_id uuid;
  v_trip_status text;
  v_allocation_state text;
  v_request_status text;
  v_authority_status text;
  v_authority_data jsonb;
  v_return_inspection_status text;
  v_incident_declared boolean := false;
  v_receipts_declared boolean := false;
  v_declarations_reconciled boolean := false;
BEGIN
  SELECT tenant_id, request_id, allocation_id, vehicle_id, status
    INTO v_tenant_id, v_request_id, v_allocation_id, v_vehicle_id, v_trip_status
  FROM trips
  WHERE id = NEW.trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: trip not found';
  END IF;

  IF v_trip_status NOT IN ('return_inspection', 'closure_review') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: trip status is %', v_trip_status;
  END IF;

  SELECT state
    INTO v_allocation_state
  FROM vehicle_allocations
  WHERE id = v_allocation_id
    AND request_id = v_request_id
    AND vehicle_id = v_vehicle_id
  FOR UPDATE;

  IF NOT FOUND OR v_allocation_state NOT IN ('provisional', 'confirmed') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: allocation is no longer active';
  END IF;

  SELECT status
    INTO v_request_status
  FROM transport_requests
  WHERE id = v_request_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND OR v_request_status <> 'in_progress' THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: request status is %', COALESCE(v_request_status, 'missing');
  END IF;

  SELECT status, data
    INTO v_authority_status, v_authority_data
  FROM trip_authorities
  WHERE trip_id = NEW.trip_id
    AND tenant_id = v_tenant_id
    AND allocation_id = v_allocation_id
  FOR UPDATE;

  IF NOT FOUND OR v_authority_status NOT IN ('awaiting_reconciliation', 'completed') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: authority status is %', COALESCE(v_authority_status, 'missing');
  END IF;

  v_incident_declared := COALESCE(
    (v_authority_data -> 'returnDeclaration' ->> 'incidentDeclared')::boolean,
    false
  );
  v_receipts_declared := COALESCE(
    (v_authority_data -> 'returnDeclaration' ->> 'outstandingReceiptsDeclared')::boolean,
    false
  );
  v_declarations_reconciled := NULLIF(
    v_authority_data -> 'returnDeclaration' ->> 'reconciledAt',
    ''
  ) IS NOT NULL;

  IF (v_incident_declared OR v_receipts_declared) AND NOT v_declarations_reconciled THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: return declarations require reconciliation';
  END IF;

  IF v_incident_declared AND NOT EXISTS (
    SELECT 1
    FROM trip_incidents ti
    WHERE ti.trip_id = NEW.trip_id
      AND ti.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: return declared an incident but no incident record exists';
  END IF;

  IF v_receipts_declared
     AND NOT EXISTS (
       SELECT 1
       FROM fuel_receipts fr
       JOIN fuel_transactions ft ON ft.id = fr.transaction_id
       JOIN vehicles v ON v.id = ft.vehicle_id
       WHERE ft.trip_id = NEW.trip_id
         AND v.tenant_id = v_tenant_id
         AND (fr.tenant_id IS NULL OR fr.tenant_id = v_tenant_id)
     )
     AND NOT EXISTS (
       SELECT 1
       FROM trip_expenses te
       WHERE te.trip_id = NEW.trip_id
         AND te.tenant_id = v_tenant_id
         AND te.receipt_key IS NOT NULL
         AND length(trim(te.receipt_key)) > 0
     ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: return declared outstanding receipts but no receipt evidence exists';
  END IF;

  -- Only the newest return inspection for the currently allocated vehicle can
  -- satisfy reconciliation. Starting a reinspection invalidates reliance on an
  -- older submitted inspection until the new one is itself submitted.
  SELECT vi.status
    INTO v_return_inspection_status
  FROM vehicle_inspections vi
  WHERE vi.trip_id = NEW.trip_id
    AND vi.tenant_id = v_tenant_id
    AND vi.vehicle_id = v_vehicle_id
    AND vi.type = 'return'
  ORDER BY vi.created_at DESC, vi.id DESC
  LIMIT 1;

  IF v_return_inspection_status IS NULL
     OR v_return_inspection_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: latest return inspection status is %',
      COALESCE(v_return_inspection_status, 'missing');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM fuel_transactions ft
    JOIN vehicles v ON v.id = ft.vehicle_id
    WHERE ft.trip_id = NEW.trip_id
      AND v.tenant_id = v_tenant_id
      AND ft.is_verified = false
  ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: unverified fuel transaction remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trip_expenses te
    WHERE te.trip_id = NEW.trip_id
      AND te.tenant_id = v_tenant_id
      AND te.verification_status <> 'verified'
  ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: unverified expense remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM trip_incidents ti
    WHERE ti.trip_id = NEW.trip_id
      AND ti.tenant_id = v_tenant_id
      AND ti.safe_to_continue = false
      AND ti.status <> 'resolved'
  ) THEN
    RAISE EXCEPTION 'trip_closure_lifecycle_conflict: unresolved safety-critical incident remains';
  END IF;

  RETURN NEW;
END;
$$;
