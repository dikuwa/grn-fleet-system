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

-- A workflow transition must never carry the previous step's assignee into a
-- new current_step_order. Newer writers can set assignment metadata with the
-- new stepOrder in the same UPDATE; legacy/specialised transition writers are
-- made safe by clearing stale assignment fields automatically.
CREATE OR REPLACE FUNCTION clear_stale_workflow_current_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_step integer;
BEGIN
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

  IF NEW.status IS DISTINCT FROM 'active' THEN
    NEW.current_assigned_user_id := NULL;
    NEW.current_assigned_employee_id := NULL;
    NEW.current_role_assignment_id := NULL;
    NEW.current_assignment_is_acting := false;
    NEW.current_assignment_source := NULL;
    NEW.current_assignment_metadata := '{}'::jsonb;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_instances_clear_stale_assignment ON workflow_instances;
CREATE TRIGGER workflow_instances_clear_stale_assignment
BEFORE UPDATE OF current_step_order, status, current_assigned_user_id,
  current_assigned_employee_id, current_role_assignment_id,
  current_assignment_is_acting, current_assignment_source,
  current_assignment_metadata
ON workflow_instances
FOR EACH ROW
EXECUTE FUNCTION clear_stale_workflow_current_assignment();

-- Safe backfill for explicit/fixed assignees already stored on the definition.
-- Dynamically resolved permission/delegation holders are intentionally left
-- null; the workflow engine will refresh those assignments per instance.
UPDATE workflow_instances wi
SET current_assigned_user_id = ws.assigned_user_id,
    current_assignment_source = 'definition',
    current_assignment_metadata = jsonb_build_object(
      'definitionStepId', ws.id,
      'stepOrder', wi.current_step_order,
      'backfilled', true
    )
FROM workflow_steps ws
WHERE wi.status = 'active'
  AND ws.definition_id = wi.definition_id
  AND ws.step_order = wi.current_step_order
  AND ws.assigned_user_id IS NOT NULL
  AND wi.current_assigned_user_id IS NULL;
