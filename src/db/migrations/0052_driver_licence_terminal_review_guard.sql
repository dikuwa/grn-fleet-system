-- Ensure exactly one terminal review decision can commit for each licence version.
-- The review API batches the licence update, profile changes and audit insert in
-- one transaction. Under a concurrent Approve/Reject race the guarded licence
-- update in the losing transaction affects zero rows, but without a second
-- invariant its profile/audit builders could still commit. This partial unique
-- index makes the immutable audit row the transaction's single-winner claim:
-- one terminal review audit per licence, regardless of which terminal action won.

CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_licence_terminal_review_audit
ON audit_events (entity_id)
WHERE entity_type = 'driver_licence'
  AND action IN (
    'driver_licence.verify',
    'driver_licence.approve',
    'driver_licence.reject'
  );
