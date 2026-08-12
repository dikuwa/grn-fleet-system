-- A vehicle allocation is the durable parent of exactly one operational trip.
-- The application already checks for an existing trip before insertion, but
-- concurrent requests can both pass that read. Keep the database as the final
-- concurrency guard so retries/races cannot create duplicate operational trips.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_allocation
  ON trips (allocation_id);
