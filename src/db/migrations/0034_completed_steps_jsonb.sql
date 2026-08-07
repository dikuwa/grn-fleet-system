-- 0034_completed_steps_jsonb.sql
-- Change tenant_setup_progress.completed_steps from INTEGER to JSONB
-- so it can store an array of completed step indices instead of a scalar count.

ALTER TABLE "tenant_setup_progress"
  ALTER COLUMN "completed_steps" TYPE jsonb
  USING '[]'::jsonb;

ALTER TABLE "tenant_setup_progress"
  ALTER COLUMN "completed_steps" SET DEFAULT '[]'::jsonb;
