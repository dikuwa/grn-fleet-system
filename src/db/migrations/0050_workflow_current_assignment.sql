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

-- Safe backfill for explicit/fixed assignees already stored on the definition.
-- Dynamically resolved permission/delegation holders are intentionally left
-- null; the workflow engine will refresh those assignments per instance.
UPDATE workflow_instances wi
SET current_assigned_user_id = ws.assigned_user_id,
    current_assignment_source = 'definition',
    current_assignment_metadata = jsonb_build_object(
      'definitionStepId', ws.id,
      'backfilled', true
    )
FROM workflow_steps ws
WHERE wi.status = 'active'
  AND ws.definition_id = wi.definition_id
  AND ws.step_order = wi.current_step_order
  AND ws.assigned_user_id IS NOT NULL
  AND wi.current_assigned_user_id IS NULL;
