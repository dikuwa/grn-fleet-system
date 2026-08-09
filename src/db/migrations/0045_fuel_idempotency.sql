CREATE UNIQUE INDEX IF NOT EXISTS "uq_fuel_transactions_client_sync"
  ON "fuel_transactions" ("client_sync_id")
  WHERE "client_sync_id" IS NOT NULL;
