-- A relief-driver handover is completed by the relief driver from the
-- authenticated Driver workspace. Prevent creating a pending handover that
-- cannot ever be acknowledged because the employee has no acknowledgement-
-- capable account.
--
-- Keep this check at the database boundary so stale clients and concurrent
-- account-link changes cannot bypass the API's eligibility checks.

CREATE OR REPLACE FUNCTION guard_pending_relief_driver_account()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.driver_type = 'relief' AND NEW.acknowledged_at IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM employees e
      INNER JOIN tenant_memberships tm
        ON tm.user_id = e.user_id
       AND tm.tenant_id = e.tenant_id
       AND tm.status = 'active'
      INNER JOIN role_assignments ra
        ON ra.tenant_membership_id = tm.id
       AND ra.start_date <= now()
       AND (ra.end_date IS NULL OR ra.end_date >= now())
      INNER JOIN roles r
        ON r.id = ra.role_id
       AND r.tenant_id = e.tenant_id
       AND r.name = 'Assigned Driver'
      INNER JOIN role_permissions rp
        ON rp.role_id = r.id
       AND rp.permission_code = 'driver:log-create'
      WHERE e.id = NEW.employee_id
        AND e.employment_status = 'active'
        AND e.is_driver = true
        AND e.user_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'atomic_driver_handover_initiate_failed relief_driver_acknowledgement_account_required'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_authorised_driver_account_guard ON trip_authorised_drivers;
CREATE TRIGGER trip_authorised_driver_account_guard
BEFORE INSERT OR UPDATE OF employee_id, driver_type, acknowledged_at
ON trip_authorised_drivers
FOR EACH ROW
EXECUTE FUNCTION guard_pending_relief_driver_account();

-- Once a relief handover is pending on an active trip, keep the employee-to-user
-- identity stable until acknowledgement completes. Otherwise an account unlink
-- or swap after handover initiation can strand the active trip even though the
-- initial insert was valid.
CREATE OR REPLACE FUNCTION guard_pending_relief_driver_account_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.user_id IS DISTINCT FROM NEW.user_id
     AND EXISTS (
       SELECT 1
       FROM trip_authorised_drivers tad
       INNER JOIN trip_authorities ta ON ta.id = tad.authority_id
       INNER JOIN trips t ON t.id = ta.trip_id
       WHERE tad.employee_id = NEW.id
         AND tad.driver_type = 'relief'
         AND tad.acknowledged_at IS NULL
         AND t.status IN ('in_progress', 'return_due')
     ) THEN
    RAISE EXCEPTION 'pending_relief_driver_account_change_blocked'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_pending_relief_driver_account_guard ON employees;
CREATE TRIGGER employee_pending_relief_driver_account_guard
BEFORE UPDATE OF user_id
ON employees
FOR EACH ROW
EXECUTE FUNCTION guard_pending_relief_driver_account_change();
