-- External-driver assignments must have a terminal successful state after trip reconciliation.
-- Keep pending_acceptance/accepted as the only live states used by the existing partial unique indexes.

ALTER TABLE external_driver_assignments
  DROP CONSTRAINT IF EXISTS chk_external_driver_assignment_state;

ALTER TABLE external_driver_assignments
  ADD CONSTRAINT chk_external_driver_assignment_state
  CHECK (state IN ('pending_acceptance', 'accepted', 'completed', 'cancelled'));
