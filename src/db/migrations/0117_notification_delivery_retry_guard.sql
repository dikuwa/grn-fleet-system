ALTER TABLE "notification_deliveries"
ADD COLUMN IF NOT EXISTS "retry_of_delivery_id" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_retry_predecessor_idx"
ON "notification_deliveries" ("retry_of_delivery_id")
WHERE "retry_of_delivery_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_one_pending_per_channel_idx"
ON "notification_deliveries" ("notification_id", "channel")
WHERE "status" = 'pending';
