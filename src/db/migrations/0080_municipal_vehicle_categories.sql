-- Broaden the tenant-owned fleet category catalogue for municipal and public
-- sector fleets. Existing names are preserved and duplicates are avoided.

WITH defaults(name, code, description, passenger_capacity, cargo_capacity, suitable_terrain, fuel_type, sort_order) AS (
  VALUES
    ('Sedan', 'SEDAN', 'Standard passenger vehicle', 5, NULL, 'tar', 'petrol', 10),
    ('Hatchback', 'HATCHBACK', 'Compact passenger vehicle', 5, NULL, 'tar', 'petrol', 20),
    ('Station Wagon', 'STATION_WAGON', 'Passenger vehicle with extended cargo area', 5, 'medium', 'tar', 'petrol', 30),
    ('SUV / 4x4', 'SUV_4X4', 'Sport utility or four-wheel-drive field vehicle', 7, 'medium', 'offroad', 'diesel', 40),
    ('Bakkie (Double Cab)', 'BAKKIE_DC', 'Double-cab pickup for passengers and field work', 5, 'medium', 'gravel', 'diesel', 50),
    ('Bakkie (Single Cab)', 'BAKKIE_SC', 'Single-cab pickup for cargo and field work', 3, 'large', 'gravel', 'diesel', 60),
    ('Panel Van', 'PANEL_VAN', 'Enclosed light commercial cargo vehicle', 3, 'large', 'tar', 'diesel', 70),
    ('Light Delivery Vehicle', 'LDV', 'General light delivery and utility vehicle', 3, 'large', 'gravel', 'diesel', 80),
    ('Minibus / Combi', 'MINIBUS', 'Passenger transport minibus or combi', 16, 'small', 'tar', 'diesel', 90),
    ('Bus / Coach', 'BUS_COACH', 'High-capacity passenger transport vehicle', 45, 'medium', 'tar', 'diesel', 100),
    ('Truck (Light)', 'TRUCK_LIGHT', 'Light-duty goods truck', 3, 'large', 'tar', 'diesel', 110),
    ('Truck (Medium)', 'TRUCK_MEDIUM', 'Medium-duty goods or works truck', 3, 'large', 'gravel', 'diesel', 120),
    ('Truck (Heavy)', 'TRUCK_HEAVY', 'Heavy-duty goods or works truck', 3, 'large', 'gravel', 'diesel', 130),
    ('Tipper / Dump Truck', 'TIPPER', 'Tipper truck for roads, waste, and construction work', 3, 'large', 'offroad', 'diesel', 140),
    ('Tanker', 'TANKER', 'Water, fuel, or service tanker', 3, 'specialised', 'gravel', 'diesel', 150),
    ('Refuse Compactor', 'REFUSE_COMPACTOR', 'Municipal refuse collection and compaction vehicle', 3, 'specialised', 'tar', 'diesel', 160),
    ('Ambulance', 'AMBULANCE', 'Emergency medical response vehicle', 5, 'medical', 'tar', 'diesel', 170),
    ('Fire & Rescue Vehicle', 'FIRE_RESCUE', 'Firefighting or rescue response vehicle', 6, 'specialised', 'tar', 'diesel', 180),
    ('Tractor / Agricultural Vehicle', 'TRACTOR', 'Agricultural, grounds, or works tractor', 2, 'specialised', 'offroad', 'diesel', 190),
    ('Road Maintenance Plant', 'ROAD_PLANT', 'Grader, roller, loader, excavator, or related plant', 2, 'specialised', 'offroad', 'diesel', 200),
    ('Utility / Special-Purpose Vehicle', 'UTILITY_SPECIAL', 'Tenant-defined operational or specialised vehicle', 5, 'specialised', 'gravel', NULL, 210),
    ('Motorcycle', 'MOTORCYCLE', 'Two-wheeled operational vehicle', 2, 'small', 'tar', 'petrol', 220),
    ('Trailer', 'TRAILER', 'Towable fleet asset or utility trailer', 0, 'large', 'gravel', NULL, 230)
)
INSERT INTO vehicle_categories (
  id, tenant_id, name, code, description, passenger_capacity, cargo_capacity,
  suitable_terrain, fuel_type, is_active, sort_order, created_at, updated_at
)
SELECT
  gen_random_uuid(), tenants.id, defaults.name, defaults.code, defaults.description,
  defaults.passenger_capacity, defaults.cargo_capacity, defaults.suitable_terrain,
  defaults.fuel_type, true, defaults.sort_order, now(), now()
FROM tenants
CROSS JOIN defaults
WHERE NOT EXISTS (
  SELECT 1
  FROM vehicle_categories existing
  WHERE existing.tenant_id = tenants.id
    AND lower(existing.name) = lower(defaults.name)
);

CREATE OR REPLACE FUNCTION seed_default_vehicle_categories()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO vehicle_categories (
    id, tenant_id, name, code, description, passenger_capacity, cargo_capacity,
    suitable_terrain, fuel_type, is_active, sort_order, created_at, updated_at
  )
  SELECT
    gen_random_uuid(), NEW.id, category.name, category.code, category.description,
    category.passenger_capacity, category.cargo_capacity, category.suitable_terrain,
    category.fuel_type, true, category.sort_order, now(), now()
  FROM (VALUES
    ('Sedan', 'SEDAN', 'Standard passenger vehicle', 5, NULL, 'tar', 'petrol', 10),
    ('Hatchback', 'HATCHBACK', 'Compact passenger vehicle', 5, NULL, 'tar', 'petrol', 20),
    ('Station Wagon', 'STATION_WAGON', 'Passenger vehicle with extended cargo area', 5, 'medium', 'tar', 'petrol', 30),
    ('SUV / 4x4', 'SUV_4X4', 'Sport utility or four-wheel-drive field vehicle', 7, 'medium', 'offroad', 'diesel', 40),
    ('Bakkie (Double Cab)', 'BAKKIE_DC', 'Double-cab pickup for passengers and field work', 5, 'medium', 'gravel', 'diesel', 50),
    ('Bakkie (Single Cab)', 'BAKKIE_SC', 'Single-cab pickup for cargo and field work', 3, 'large', 'gravel', 'diesel', 60),
    ('Panel Van', 'PANEL_VAN', 'Enclosed light commercial cargo vehicle', 3, 'large', 'tar', 'diesel', 70),
    ('Light Delivery Vehicle', 'LDV', 'General light delivery and utility vehicle', 3, 'large', 'gravel', 'diesel', 80),
    ('Minibus / Combi', 'MINIBUS', 'Passenger transport minibus or combi', 16, 'small', 'tar', 'diesel', 90),
    ('Bus / Coach', 'BUS_COACH', 'High-capacity passenger transport vehicle', 45, 'medium', 'tar', 'diesel', 100),
    ('Truck (Light)', 'TRUCK_LIGHT', 'Light-duty goods truck', 3, 'large', 'tar', 'diesel', 110),
    ('Truck (Medium)', 'TRUCK_MEDIUM', 'Medium-duty goods or works truck', 3, 'large', 'gravel', 'diesel', 120),
    ('Truck (Heavy)', 'TRUCK_HEAVY', 'Heavy-duty goods or works truck', 3, 'large', 'gravel', 'diesel', 130),
    ('Tipper / Dump Truck', 'TIPPER', 'Tipper truck for roads, waste, and construction work', 3, 'large', 'offroad', 'diesel', 140),
    ('Tanker', 'TANKER', 'Water, fuel, or service tanker', 3, 'specialised', 'gravel', 'diesel', 150),
    ('Refuse Compactor', 'REFUSE_COMPACTOR', 'Municipal refuse collection and compaction vehicle', 3, 'specialised', 'tar', 'diesel', 160),
    ('Ambulance', 'AMBULANCE', 'Emergency medical response vehicle', 5, 'medical', 'tar', 'diesel', 170),
    ('Fire & Rescue Vehicle', 'FIRE_RESCUE', 'Firefighting or rescue response vehicle', 6, 'specialised', 'tar', 'diesel', 180),
    ('Tractor / Agricultural Vehicle', 'TRACTOR', 'Agricultural, grounds, or works tractor', 2, 'specialised', 'offroad', 'diesel', 190),
    ('Road Maintenance Plant', 'ROAD_PLANT', 'Grader, roller, loader, excavator, or related plant', 2, 'specialised', 'offroad', 'diesel', 200),
    ('Utility / Special-Purpose Vehicle', 'UTILITY_SPECIAL', 'Tenant-defined operational or specialised vehicle', 5, 'specialised', 'gravel', NULL, 210),
    ('Motorcycle', 'MOTORCYCLE', 'Two-wheeled operational vehicle', 2, 'small', 'tar', 'petrol', 220),
    ('Trailer', 'TRAILER', 'Towable fleet asset or utility trailer', 0, 'large', 'gravel', NULL, 230)
  ) AS category(name, code, description, passenger_capacity, cargo_capacity, suitable_terrain, fuel_type, sort_order);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_vehicle_categories ON tenants;
CREATE TRIGGER trg_seed_default_vehicle_categories
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION seed_default_vehicle_categories();
