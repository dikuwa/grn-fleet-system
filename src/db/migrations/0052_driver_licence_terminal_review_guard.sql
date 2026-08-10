-- Ensure exactly one terminal review decision can commit for each licence version
-- without rewriting or deleting immutable historical audit rows.
--
-- The review API batches licence/profile mutations and the audit insert in one
-- transaction. A concurrent loser can otherwise perform zero-row guarded updates
-- while still committing surrounding side effects. The claim below is acquired
-- by the terminal audit insert itself, so exactly one terminal review transaction
-- can commit for a licence. If that transaction rolls back, its claim rolls back.

CREATE TABLE IF NOT EXISTS driver_licence_terminal_review_claims (
  licence_entity_id text PRIMARY KEY,
  action text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve historical audit evidence. If old data already has more than one
-- terminal event for a licence, retain history untouched and seed only the first
-- event as the future claim marker.
INSERT INTO driver_licence_terminal_review_claims (licence_entity_id, action, claimed_at)
SELECT DISTINCT ON (entity_id)
  entity_id,
  action,
  COALESCE(created_at, now())
FROM audit_events
WHERE entity_type = 'driver_licence'
  AND entity_id IS NOT NULL
  AND action IN (
    'driver_licence.verify',
    'driver_licence.approve',
    'driver_licence.reject'
  )
ORDER BY entity_id, created_at ASC NULLS LAST
ON CONFLICT (licence_entity_id) DO NOTHING;

CREATE OR REPLACE FUNCTION claim_driver_licence_terminal_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entity_type = 'driver_licence'
     AND NEW.entity_id IS NOT NULL
     AND NEW.action IN (
       'driver_licence.verify',
       'driver_licence.approve',
       'driver_licence.reject'
     ) THEN
    INSERT INTO driver_licence_terminal_review_claims (
      licence_entity_id,
      action,
      claimed_at
    )
    VALUES (
      NEW.entity_id,
      NEW.action,
      COALESCE(NEW.created_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_licence_terminal_review_claim ON audit_events;
CREATE TRIGGER trg_driver_licence_terminal_review_claim
BEFORE INSERT ON audit_events
FOR EACH ROW
EXECUTE FUNCTION claim_driver_licence_terminal_review();
