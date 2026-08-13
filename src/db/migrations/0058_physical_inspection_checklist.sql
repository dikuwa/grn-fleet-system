-- Align every tenant's active departure/return inspection template with the
-- physical GRN vehicle inspection sheet without mutating historical template
-- versions. Existing semantically-equivalent labels are reused; only genuinely
-- missing checks are added to a new active version.
--
-- Physical reference coverage:
-- licence disc expiry, windscreen, body condition, spare wheel, jack, wheel
-- spanner, head/tail/indicator/reverse lights, fuel, engine oil, coolant/water,
-- brake fluid, clutch fluid, foot/hand brakes, horn/hooter, tyres, wipers,
-- mirrors and vehicle key.

DO $$
DECLARE
  template_row RECORD;
  new_template_id uuid;
  new_version integer;
  next_sort integer;
  changed boolean;
BEGIN
  FOR template_row IN
    SELECT id, tenant_id, name, type, version
    FROM inspection_templates
    WHERE is_active = true
      AND type IN ('departure', 'return')
    ORDER BY tenant_id, type
  LOOP
    -- Create a new version only when the active template is missing at least one
    -- physical-sheet concept or when an existing safety-equivalent item is not
    -- yet marked critical. Normalisation deliberately handles historic wording.
    SELECT
      NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['licencediscexpirydate','licensediscexpirydate','licencediscexpiry','licensediscexpiry','licencedisc','licensedisc','vehiclelicenceexpiry','vehiclelicenseexpiry'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['frontscreen','windscreen','windshield','frontwindscreen'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['bodycondition','vehiclebodycondition','bodywork','exteriorbodycondition','exteriorcondition'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['sparewheel','sparetyre','sparetire'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['jack','vehiclejack'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['wheelspanner','wheelbrace','lugwrench','wheelwrench'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['headlights','headlight','headlamps','headlamp'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['taillights','taillight','rearlights','rearlight'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['indicatorlights','indicatorslights','indicators','turnsignals','signallights'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['reverselight','reverselights','backuplight','backuplights'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['fuellevel','fuel'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['engineoillevel','oillevel','engineoil'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['waterlevel','coolantlevel','enginecoolantlevel','coolant'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['brakefluid','brakefluidlevel'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['clutchfluid','clutchfluidlevel'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['footandhandbrakes','footbrakeandhandbrake','serviceandparkingbrakes','serviceparkingbrakes','brakes','brakeoperation'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['hooter','horn','vehiclehorn'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['tyres','tires','tyrecondition','tirecondition','tyresandwheels','tiresandwheels'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['wipers','windscreenwipers','windshieldwipers','wiperoperation'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['mirrors','mirrorcondition','rearviewmirrors','rearviewanddoormirrors'])
      ) OR NOT EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY['key','vehiclekey','vehiclekeys','keys'])
      ) OR EXISTS (
        SELECT 1 FROM inspection_template_items i
        WHERE i.template_id = template_row.id
          AND i.is_critical = false
          AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY[
            'frontscreen','windscreen','windshield','frontwindscreen',
            'headlights','headlight','headlamps','headlamp',
            'taillights','taillight','rearlights','rearlight',
            'indicatorlights','indicatorslights','indicators','turnsignals','signallights',
            'reverselight','reverselights','backuplight','backuplights',
            'engineoillevel','oillevel','engineoil',
            'waterlevel','coolantlevel','enginecoolantlevel','coolant',
            'brakefluid','brakefluidlevel','clutchfluid','clutchfluidlevel',
            'footandhandbrakes','footbrakeandhandbrake','serviceandparkingbrakes','serviceparkingbrakes','brakes','brakeoperation',
            'hooter','horn','vehiclehorn',
            'tyres','tires','tyrecondition','tirecondition','tyresandwheels','tiresandwheels',
            'wipers','windscreenwipers','windshieldwipers','wiperoperation',
            'mirrors','mirrorcondition','rearviewmirrors','rearviewanddoormirrors'
          ])
      )
    INTO changed;

    IF NOT changed THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(version), 0) + 1
    INTO new_version
    FROM inspection_templates
    WHERE tenant_id = template_row.tenant_id
      AND type = template_row.type;

    -- The partial unique index allows only one active template, so retire the
    -- previous version before activating the replacement.
    UPDATE inspection_templates
    SET is_active = false, updated_at = now()
    WHERE id = template_row.id;

    INSERT INTO inspection_templates (tenant_id, name, type, version, is_active, created_at, updated_at)
    VALUES (template_row.tenant_id, template_row.name, template_row.type, new_version, true, now(), now())
    RETURNING id INTO new_template_id;

    INSERT INTO inspection_template_items (
      template_id, sort_order, category, label, requires_photo, is_critical, created_at
    )
    SELECT
      new_template_id,
      sort_order,
      category,
      label,
      requires_photo,
      CASE
        WHEN regexp_replace(lower(label), '[^a-z0-9]+', '', 'g') = ANY (ARRAY[
          'frontscreen','windscreen','windshield','frontwindscreen',
          'headlights','headlight','headlamps','headlamp',
          'taillights','taillight','rearlights','rearlight',
          'indicatorlights','indicatorslights','indicators','turnsignals','signallights',
          'reverselight','reverselights','backuplight','backuplights',
          'engineoillevel','oillevel','engineoil',
          'waterlevel','coolantlevel','enginecoolantlevel','coolant',
          'brakefluid','brakefluidlevel','clutchfluid','clutchfluidlevel',
          'footandhandbrakes','footbrakeandhandbrake','serviceandparkingbrakes','serviceparkingbrakes','brakes','brakeoperation',
          'hooter','horn','vehiclehorn',
          'tyres','tires','tyrecondition','tirecondition','tyresandwheels','tiresandwheels',
          'wipers','windscreenwipers','windshieldwipers','wiperoperation',
          'mirrors','mirrorcondition','rearviewmirrors','rearviewanddoormirrors'
        ]) THEN true
        ELSE is_critical
      END,
      now()
    FROM inspection_template_items
    WHERE template_id = template_row.id
    ORDER BY sort_order;

    SELECT COALESCE(MAX(sort_order), 0)
    INTO next_sort
    FROM inspection_template_items
    WHERE template_id = new_template_id;

    -- Add only physical-sheet concepts which are not already represented by an
    -- equivalent label in the cloned template. All failures block the current
    -- inspection from releasing the vehicle; is_critical additionally moves
    -- the vehicle to maintenance and creates a blocking critical defect.
    WITH physical_items(label, category, is_critical, aliases, ordinal) AS (
      VALUES
        ('Licence disc expiry date', 'documents', false, ARRAY['licencediscexpirydate','licensediscexpirydate','licencediscexpiry','licensediscexpiry','licencedisc','licensedisc','vehiclelicenceexpiry','vehiclelicenseexpiry'], 1),
        ('Windscreen / front screen', 'exterior', true, ARRAY['frontscreen','windscreen','windshield','frontwindscreen'], 2),
        ('Body condition', 'exterior', false, ARRAY['bodycondition','vehiclebodycondition','bodywork','exteriorbodycondition','exteriorcondition'], 3),
        ('Spare wheel', 'equipment', false, ARRAY['sparewheel','sparetyre','sparetire'], 4),
        ('Jack', 'equipment', false, ARRAY['jack','vehiclejack'], 5),
        ('Wheel spanner', 'equipment', false, ARRAY['wheelspanner','wheelbrace','lugwrench','wheelwrench'], 6),
        ('Head lights', 'lights', true, ARRAY['headlights','headlight','headlamps','headlamp'], 7),
        ('Tail lights', 'lights', true, ARRAY['taillights','taillight','rearlights','rearlight'], 8),
        ('Indicator lights', 'lights', true, ARRAY['indicatorlights','indicatorslights','indicators','turnsignals','signallights'], 9),
        ('Reverse light', 'lights', true, ARRAY['reverselight','reverselights','backuplight','backuplights'], 10),
        ('Fuel level', 'fuel', false, ARRAY['fuellevel','fuel'], 11),
        ('Engine oil level', 'safety', true, ARRAY['engineoillevel','oillevel','engineoil'], 12),
        ('Coolant / water level', 'safety', true, ARRAY['waterlevel','coolantlevel','enginecoolantlevel','coolant'], 13),
        ('Brake fluid', 'safety', true, ARRAY['brakefluid','brakefluidlevel'], 14),
        ('Clutch fluid', 'safety', true, ARRAY['clutchfluid','clutchfluidlevel'], 15),
        ('Foot & hand brakes', 'safety', true, ARRAY['footandhandbrakes','footbrakeandhandbrake','serviceandparkingbrakes','serviceparkingbrakes','brakes','brakeoperation'], 16),
        ('Horn / hooter', 'safety', true, ARRAY['hooter','horn','vehiclehorn'], 17),
        ('Tyres', 'tyres', true, ARRAY['tyres','tires','tyrecondition','tirecondition','tyresandwheels','tiresandwheels'], 18),
        ('Wipers', 'safety', true, ARRAY['wipers','windscreenwipers','windshieldwipers','wiperoperation'], 19),
        ('Mirrors', 'safety', true, ARRAY['mirrors','mirrorcondition','rearviewmirrors','rearviewanddoormirrors'], 20),
        ('Vehicle key', 'equipment', false, ARRAY['key','vehiclekey','vehiclekeys','keys'], 21)
    )
    INSERT INTO inspection_template_items (
      template_id, sort_order, category, label, requires_photo, is_critical, created_at
    )
    SELECT
      new_template_id,
      next_sort + p.ordinal,
      p.category,
      p.label,
      false,
      p.is_critical,
      now()
    FROM physical_items p
    WHERE NOT EXISTS (
      SELECT 1
      FROM inspection_template_items i
      WHERE i.template_id = new_template_id
        AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') = ANY (p.aliases)
    )
    ORDER BY p.ordinal;
  END LOOP;
END $$;
