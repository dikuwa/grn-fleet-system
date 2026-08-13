ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "current_assigned_user_id" text;

ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "current_assignment_meta" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN "workflow_instances"."current_assigned_user_id" IS
  'Request-scoped current-step assignee override, used for conflict-of-interest reassignment without mutating the shared workflow definition.';

COMMENT ON COLUMN "workflow_instances"."current_assignment_meta" IS
  'Request-scoped metadata for the current assignee override (role, acting/delegation and conflict context).';
