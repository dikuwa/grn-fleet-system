-- Optional tenant policy: when any active fleet-payment provider requires an
-- instrument before release, physical vehicle issue must have an active
-- allocation assignment. The policy defaults OFF, including the KERC seed,
-- so existing operations are not blocked before real instruments are loaded.
CREATE OR REPLACE FUNCTION grn_require_fleet_payment_before_issue()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id uuid;
  v_vehicle_id uuid;
  v_required boolean := false;
  v_ready boolean := false;
BEGIN
  SELECT r.tenant_id, a.vehicle_id
  INTO v_tenant_id, v_vehicle_id
  FROM vehicle_allocations a
  JOIN transport_requests r ON r.id = a.request_id
  WHERE a.id = NEW.allocation_id;

  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM fleet_payment_providers p
    WHERE p.tenant_id = v_tenant_id
      AND p.status = 'active'
      AND p.require_for_release = true
  ) INTO v_required;

  IF NOT v_required THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM fleet_payment_assignments a
    JOIN fleet_payment_instruments i ON i.id = a.instrument_id
    JOIN fleet_payment_providers p ON p.id = i.provider_id
    WHERE a.tenant_id = v_tenant_id
      AND a.allocation_id = NEW.allocation_id
      AND a.vehicle_id = v_vehicle_id
      AND a.status = 'assigned'
      AND i.status = 'active'
      AND p.status = 'active'
      AND p.require_for_release = true
      AND (i.valid_from IS NULL OR i.valid_from <= now())
      AND (i.valid_until IS NULL OR i.valid_until >= now())
  ) INTO v_ready;

  IF NOT v_ready THEN
    RAISE EXCEPTION 'fleet_payment_assignment_required'
      USING HINT = 'Register/assign an active fleet payment card or vehicle tag, or disable the tenant release requirement.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_require_fleet_payment_before_issue ON trip_issues;
CREATE TRIGGER trg_require_fleet_payment_before_issue
BEFORE INSERT ON trip_issues
FOR EACH ROW EXECUTE FUNCTION grn_require_fleet_payment_before_issue();
