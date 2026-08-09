-- Persist the resolved holder of the CURRENT workflow step on the workflow
-- instance itself. Workflow definitions remain reusable/static; request-level
-- acting/delegated/conflict assignments must never mutate workflow_steps.

ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS current_assigned_user_id text,
  ADD COLUMN IF NOT EXISTS current_assigned_employee_id uuid,
  ADD COLUMN IF NOT EXISTS current_role_assignment_id uuid,
  ADD COLUMN IF NOT EXISTS current_assignment_is_acting boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_assignment_source text,
  ADD COLUMN IF NOT EXISTS current_assignment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS workflow_instances_current_assigned_user_idx
  ON workflow_instances (current_assigned_user_id)
  WHERE status = 'active' AND current_assigned_user_id IS NOT NULL;

-- Keep current assignment aligned with current_step_order for every writer,
-- including specialised atomic transition services that pre-date migration
-- 0050. If a newer writer already supplies assignment metadata for the new
-- step, it is preserved. Otherwise this trigger resolves the holder from:
--   1. Driver allocation for acknowledgement,
--   2. explicit workflow-step assignee,
--   3. active acting delegation with the required capability,
--   4. active substantive role assignment carrying the required permission.
CREATE OR REPLACE FUNCTION reconcile_workflow_current_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_step integer;
  step_action text;
  step_permission text;
  fixed_assigned_user text;
  fixed_step_id uuid;
  request_tenant_id uuid;
  resolved_user_id text;
  resolved_employee_id uuid;
  resolved_assignment_id uuid;
  resolved_role_id uuid;
  resolved_is_acting boolean := false;
  resolved_source text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    NEW.current_assigned_user_id := NULL;
    NEW.current_assigned_employee_id := NULL;
    NEW.current_role_assignment_id := NULL;
    NEW.current_assignment_is_acting := false;
    NEW.current_assignment_source := NULL;
    NEW.current_assignment_metadata := '{}'::jsonb;
    RETURN NEW;
  END IF;

  IF NEW.current_step_order IS DISTINCT FROM OLD.current_step_order THEN
    assignment_step := NULLIF(NEW.current_assignment_metadata ->> 'stepOrder', '')::integer;
    IF assignment_step IS DISTINCT FROM NEW.current_step_order THEN
      NEW.current_assigned_user_id := NULL;
      NEW.current_assigned_employee_id := NULL;
      NEW.current_role_assignment_id := NULL;
      NEW.current_assignment_is_acting := false;
      NEW.current_assignment_source := NULL;
      NEW.current_assignment_metadata := '{}'::jsonb;
    END IF;
  END IF;

  -- A valid assignment written by the application for this exact current step
  -- is authoritative and must not be recomputed by the trigger.
  assignment_step := NULLIF(NEW.current_assignment_metadata ->> 'stepOrder', '')::integer;
  IF NEW.current_assigned_user_id IS NOT NULL
     AND assignment_step = NEW.current_step_order THEN
    RETURN NEW;
  END IF;

  SELECT ws.action_type, ws.required_permission, ws.assigned_user_id, ws.id
  INTO step_action, step_permission, fixed_assigned_user, fixed_step_id
  FROM workflow_steps ws
  WHERE ws.definition_id = NEW.definition_id
    AND ws.step_order = NEW.current_step_order
  LIMIT 1;

  SELECT tr.tenant_id
  INTO request_tenant_id
  FROM transport_requests tr
  WHERE tr.id = NEW.request_id
  LIMIT 1;

  IF step_action IS NULL OR request_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  resolved_user_id := NULL;
  resolved_employee_id := NULL;
  resolved_assignment_id := NULL;
  resolved_role_id := NULL;
  resolved_is_acting := false;
  resolved_source := NULL;

  IF step_action = 'acknowledge' THEN
    SELECT e.user_id, e.id
    INTO resolved_user_id, resolved_employee_id
    FROM vehicle_allocations va
    INNER JOIN employees e ON e.id = va.driver_employee_id
    WHERE va.request_id = NEW.request_id
      AND va.state = 'confirmed'
      AND e.tenant_id = request_tenant_id
      AND e.employment_status = 'active'
    ORDER BY va.created_at DESC
    LIMIT 1;

    IF resolved_user_id IS NOT NULL THEN
      resolved_source := 'driver_allocation';
    END IF;
  ELSIF fixed_assigned_user IS NOT NULL THEN
    resolved_user_id := fixed_assigned_user;
    SELECT e.id
    INTO resolved_employee_id
    FROM employees e
    WHERE e.tenant_id = request_tenant_id
      AND e.user_id = fixed_assigned_user
    LIMIT 1;
    resolved_source := 'definition';
  ELSIF step_permission IS NOT NULL THEN
    -- Acting holder first, matching resolveRoleHolder() capability semantics.
    SELECT e.user_id, e.id, rd.id, r.id
    INTO resolved_user_id, resolved_employee_id, resolved_assignment_id, resolved_role_id
    FROM roles r
    INNER JOIN role_permissions rp
      ON rp.role_id = r.id
     AND rp.permission_code = step_permission
    INNER JOIN role_delegations rd
      ON rd.role_id = r.id
     AND rd.tenant_id = request_tenant_id
    INNER JOIN employees e
      ON e.id = rd.acting_employee_id
     AND e.tenant_id = request_tenant_id
    WHERE r.tenant_id = request_tenant_id
      AND rd.status IN ('scheduled', 'active')
      AND rd.start_at <= now()
      AND rd.end_at > now()
      AND e.employment_status = 'active'
      AND e.availability_status = 'available'
      AND (
        (step_action = 'authorise' AND rd.can_sign = true)
        OR (step_action = 'release' AND rd.can_allocate_vehicles = true)
        OR (step_action NOT IN ('authorise', 'release') AND rd.can_approve = true)
      )
    ORDER BY rd.start_at DESC
    LIMIT 1;

    IF resolved_user_id IS NOT NULL THEN
      resolved_is_acting := true;
      resolved_source := 'acting_delegation';
    ELSE
      -- Otherwise use a currently active substantive role holder.
      SELECT e.user_id, e.id, ra.id, r.id
      INTO resolved_user_id, resolved_employee_id, resolved_assignment_id, resolved_role_id
      FROM roles r
      INNER JOIN role_permissions rp
        ON rp.role_id = r.id
       AND rp.permission_code = step_permission
      INNER JOIN role_assignments ra
        ON ra.role_id = r.id
       AND ra.is_acting = false
      INNER JOIN tenant_memberships tm
        ON tm.id = ra.tenant_membership_id
       AND tm.tenant_id = request_tenant_id
      INNER JOIN employees e
        ON e.user_id = tm.user_id
       AND e.tenant_id = request_tenant_id
      WHERE r.tenant_id = request_tenant_id
        AND ra.start_date <= now()
        AND (ra.end_date IS NULL OR ra.end_date > now())
        AND e.employment_status = 'active'
        AND e.availability_status = 'available'
      ORDER BY ra.start_date DESC
      LIMIT 1;

      IF resolved_user_id IS NOT NULL THEN
        resolved_source := 'substantive_role';
      END IF;
    END IF;
  END IF;

  IF resolved_user_id IS NOT NULL THEN
    NEW.current_assigned_user_id := resolved_user_id;
    NEW.current_assigned_employee_id := resolved_employee_id;
    NEW.current_role_assignment_id := resolved_assignment_id;
    NEW.current_assignment_is_acting := resolved_is_acting;
    NEW.current_assignment_source := resolved_source;
    NEW.current_assignment_metadata := jsonb_build_object(
      'definitionStepId', fixed_step_id,
      'stepOrder', NEW.current_step_order,
      'actionType', step_action,
      'requiredPermission', step_permission,
      'resolvedRoleId', resolved_role_id,
      'triggerResolved', true,
      'persistedAt', now()
    );
  ELSE
    NEW.current_assigned_user_id := NULL;
    NEW.current_assigned_employee_id := NULL;
    NEW.current_role_assignment_id := NULL;
    NEW.current_assignment_is_acting := false;
    NEW.current_assignment_source := NULL;
    NEW.current_assignment_metadata := jsonb_build_object(
      'definitionStepId', fixed_step_id,
      'stepOrder', NEW.current_step_order,
      'actionType', step_action,
      'requiredPermission', step_permission,
      'triggerResolved', true,
      'unassigned', true,
      'persistedAt', now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_instances_clear_stale_assignment ON workflow_instances;
DROP TRIGGER IF EXISTS workflow_instances_reconcile_current_assignment ON workflow_instances;
CREATE TRIGGER workflow_instances_reconcile_current_assignment
BEFORE UPDATE OF current_step_order, status, current_assigned_user_id,
  current_assigned_employee_id, current_role_assignment_id,
  current_assignment_is_acting, current_assignment_source,
  current_assignment_metadata
ON workflow_instances
FOR EACH ROW
EXECUTE FUNCTION reconcile_workflow_current_assignment();

-- Resolve all pre-existing active instances through the same invariant. UPDATE
-- OF triggers fire because current_assignment_metadata is named in SET, even
-- when the JSON value itself is unchanged.
UPDATE workflow_instances
SET current_assignment_metadata = current_assignment_metadata
WHERE status = 'active';
