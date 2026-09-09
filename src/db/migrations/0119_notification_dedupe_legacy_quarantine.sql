-- Quarantine every historical notification dedupe token before public API
-- callers lose dedupe-key persistence. This prevents previously caller-controlled
-- values from continuing to suppress legitimate future internal notifications.
--
-- The reserved prefix also makes the migration replay-safe: already quarantined
-- rows are left unchanged. Future internal producers continue using their current
-- raw deterministic keys, while public API notifications persist NULL dedupe keys.
LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;

UPDATE notifications
SET dedupe_key = 'legacy-quarantine:v1:' || dedupe_key
WHERE dedupe_key IS NOT NULL
  AND dedupe_key NOT LIKE 'legacy-quarantine:v1:%';
