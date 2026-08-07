-- 0039_vehicle_replacement.sql
-- WS6: Vehicle replacement tracking & per-vehicle kilometre separation.
--
-- Adds columns to `vehicle_allocations` to record when a vehicle was
-- replaced during a trip, and adds `vehicle_odometer_readings` (jsonb)
-- to `trip_closures` so the trip closure can store per-vehicle odometer
-- data when a trip uses more than one vehicle.

-- 1. Vehicle allocation replacement tracking
ALTER TABLE vehicle_allocations
    ADD COLUMN IF NOT EXISTS replaced_from_vehicle_id uuid REFERENCES vehicles(id),
    ADD COLUMN IF NOT EXISTS replacement_reason text,
    ADD COLUMN IF NOT EXISTS replacement_at timestamptz;

-- Index for querying allocations that had replacements
CREATE INDEX IF NOT EXISTS idx_vehicle_allocations_replaced_from
    ON vehicle_allocations (replaced_from_vehicle_id)
    WHERE replaced_from_vehicle_id IS NOT NULL;

-- 2. Per-vehicle odometer readings on trip closures
-- Structure: { "<vehicleId>": { "start": <int>, "end": <int> } }
-- Only populated when a trip had a vehicle replacement; otherwise the
-- existing `authorised_kilometres` / `actual_kilometres` columns suffice.
ALTER TABLE trip_closures
    ADD COLUMN IF NOT EXISTS vehicle_odometer_readings jsonb
        DEFAULT '{}'::jsonb;
