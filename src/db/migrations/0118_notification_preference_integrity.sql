-- Prevent concurrent preference writers from recreating duplicates while this
-- migration ranks, removes, and constrains existing rows.
LOCK TABLE notification_preferences IN SHARE ROW EXCLUSIVE MODE;

-- Keep exactly one preference row per tenant/user before enforcing the invariant.
-- Prefer the most recently updated row, with stable created_at/id tie-breakers.
WITH ranked_preferences AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, user_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_rank
  FROM notification_preferences
)
DELETE FROM notification_preferences AS preferences
USING ranked_preferences AS ranked
WHERE preferences.id = ranked.id
  AND ranked.row_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_tenant_user_idx
ON notification_preferences (tenant_id, user_id);
