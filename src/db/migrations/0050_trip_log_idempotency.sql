WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_sync_id
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM trip_log_entries
  WHERE client_sync_id IS NOT NULL
)
UPDATE trip_log_entries AS logs
SET client_sync_id = NULL
FROM ranked
WHERE logs.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_trip_log_entries_client_sync"
  ON "trip_log_entries" ("client_sync_id")
  WHERE "client_sync_id" IS NOT NULL;
