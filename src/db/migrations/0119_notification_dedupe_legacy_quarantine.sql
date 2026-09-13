-- 0119_notification_dedupe_legacy_quarantine.sql
-- Stage 2 of the notification dedupe rollout.
--
-- Preconditions:
--   1. The public notification API no longer persists caller-provided dedupe keys.
--   2. That Stage 1 boundary is confirmed live before this migration is merged/deployed.
--
-- Historical dedupe keys came from both trusted internal workflows and the old public API,
-- so provenance cannot be reconstructed reliably. Quarantine every historical non-NULL key
-- into a reserved, row-unique namespace. This intentionally resets pre-migration dedupe
-- continuity; future internal workflow notifications resume normal idempotency from their
-- first post-migration emission.
--
-- A two-phase NULL -> quarantine rewrite is required because legacy callers could have stored
-- arbitrary strings, including values that already look like another row's quarantine target.
-- Clearing all rows selected for rewrite before assigning row-unique targets avoids transient
-- collisions with the existing global unique dedupe index.

LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE notification_dedupe_quarantine_ids (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO notification_dedupe_quarantine_ids (id)
SELECT id
FROM notifications
WHERE dedupe_key IS NOT NULL
  AND dedupe_key <> 'legacy-quarantine:v1:' || id::text;

UPDATE notifications AS n
SET dedupe_key = NULL
FROM notification_dedupe_quarantine_ids AS q
WHERE n.id = q.id;

UPDATE notifications AS n
SET dedupe_key = 'legacy-quarantine:v1:' || n.id::text
FROM notification_dedupe_quarantine_ids AS q
WHERE n.id = q.id;
