ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "current_assigned_user_id" text;

ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "current_assignment_meta" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN "workflow_instances"."current_assigned_user_id" IS
  'Request-scoped current-step assignee override, used for conflict-of-interest reassignment without mutating the shared workflow definition.';

COMMENT ON COLUMN "workflow_instances"."current_assignment_meta" IS
  'Request-scoped metadata for the current assignee override (role, acting/delegation and conflict context).';

-- Keep request-scoped reassignment state tied to exactly one active step.
-- The production approval route has multiple atomic decision services; making
-- this a database invariant prevents any current or future transition path
-- from accidentally carrying an alternate officer into the next workflow step.
CREATE OR REPLACE FUNCTION clear_workflow_instance_assignment_on_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_step_order IS DISTINCT FROM OLD.current_step_order
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.current_assigned_user_id := NULL;
    NEW.current_assignment_meta := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_instance_assignment_transition_clear
  ON workflow_instances;

CREATE TRIGGER workflow_instance_assignment_transition_clear
BEFORE UPDATE OF current_step_order, status ON workflow_instances
FOR EACH ROW
EXECUTE FUNCTION clear_workflow_instance_assignment_on_transition();
