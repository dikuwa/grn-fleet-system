CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_one_pending_per_channel_idx"
ON "notification_deliveries" ("notification_id", "channel")
WHERE "status" = 'pending';
