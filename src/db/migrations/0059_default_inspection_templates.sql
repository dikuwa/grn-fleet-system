-- Ensure every newly-created tenant receives operational departure and return
-- inspection templates that cover the physical GRN vehicle inspection sheet.
-- Existing tenants are handled by 0058; this trigger covers every tenant
-- creation pathway without duplicating seeding logic in individual API routes.
--
-- The default remains a superset of the physical sheet: the existing GRN FLEET
-- safety checks (seat belts, fire extinguisher, first-aid kit, warning triangle,
-- roadworthy certificate and return interior condition) are retained rather
-- than being replaced by the physical-sheet rows.

CREATE OR REPLACE FUNCTION seed_default_vehicle_inspection_templates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  inspection_type text;
  template_id uuid;
BEGIN
  FOREACH inspection_type IN ARRAY ARRAY['departure', 'return']
  LOOP
    INSERT INTO inspection_templates (
      tenant_id, name, type, version, is_active, created_at, updated_at
    ) VALUES (
      NEW.id,
      CASE WHEN inspection_type = 'departure'
        THEN 'Standard Departure Inspection'
        ELSE 'Standard Return Inspection'
      END,
      inspection_type,
      1,
      true,
      now(),
      now()
    )
    RETURNING id INTO template_id;

    INSERT INTO inspection_template_items (
      template_id, sort_order, category, label, requires_photo, is_critical, created_at
    ) VALUES
      (template_id, 1,  'documents', 'Licence disc expiry date', inspection_type = 'departure', false, now()),
      (template_id, 2,  'exterior',  'Windscreen / front screen', false, true,  now()),
      (template_id, 3,  'exterior',  'Body condition',             true,  false, now()),
      (template_id, 4,  'equipment', 'Spare wheel',                false, false, now()),
      (template_id, 5,  'equipment', 'Jack',                       false, false, now()),
      (template_id, 6,  'equipment', 'Wheel spanner',              false, false, now()),
      (template_id, 7,  'lights',    'Head lights',                false, true,  now()),
      (template_id, 8,  'lights',    'Tail lights',                false, true,  now()),
      (template_id, 9,  'lights',    'Indicator lights',           false, true,  now()),
      (template_id, 10, 'lights',    'Reverse light',              false, true,  now()),
      (template_id, 11, 'fuel',      'Fuel level',                 false, false, now()),
      (template_id, 12, 'safety',    'Engine oil level',           false, true,  now()),
      (template_id, 13, 'safety',    'Coolant / water level',      false, true,  now()),
      (template_id, 14, 'safety',    'Brake fluid',                false, true,  now()),
      (template_id, 15, 'safety',    'Clutch fluid',               false, true,  now()),
      (template_id, 16, 'safety',    'Foot & hand brakes',         false, true,  now()),
      (template_id, 17, 'safety',    'Horn / hooter',              false, true,  now()),
      (template_id, 18, 'tyres',     'Tyres',                      true,  true,  now()),
      (template_id, 19, 'safety',    'Wipers',                     false, true,  now()),
      (template_id, 20, 'safety',    'Mirrors',                    false, true,  now()),
      (template_id, 21, 'equipment', 'Vehicle key',                false, false, now()),
      (template_id, 22, 'interior',  'Seat belts (all positions)', false, true,  now()),
      (template_id, 23, 'safety',    'Fire extinguisher present',  false, true,  now()),
      (template_id, 24, 'safety',    'First aid kit present',      false, false, now()),
      (template_id, 25, 'safety',    'Warning triangle/reflectors',false, false, now()),
      (template_id, 26, 'documents', 'Roadworthy certificate valid', false, true, now());

    IF inspection_type = 'return' THEN
      INSERT INTO inspection_template_items (
        template_id, sort_order, category, label, requires_photo, is_critical, created_at
      ) VALUES (
        template_id, 27, 'interior', 'Interior clean and undamaged', true, false, now()
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_vehicle_inspection_templates ON tenants;
CREATE TRIGGER trg_seed_default_vehicle_inspection_templates
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION seed_default_vehicle_inspection_templates();
