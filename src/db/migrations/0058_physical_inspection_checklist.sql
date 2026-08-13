-- Align each tenant's active departure/return inspection template with the
-- physical GRN vehicle inspection sheet without mutating historical versions.
-- Existing semantically-equivalent items are reused; only genuinely missing
-- concepts are added to a newly-versioned active template.
--
-- The matching expressions intentionally recognise the wording already used by
-- GRN FLEET (for example "Windshield and windows (no cracks)", "Horn working",
-- "Tyre tread depth and pressure", "Vehicle licence disc valid" and return
-- template "All lights functional") so this migration adds to the working
-- checklist rather than duplicating it under slightly different labels.

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
    WITH existing AS (
      SELECT
        regexp_replace(lower(label), '[^a-z0-9]+', '', 'g') AS n,
        is_critical
      FROM inspection_template_items
      WHERE template_id = template_row.id
    ),
    concepts(key, matcher, critical) AS (
      VALUES
        ('licence_disc', '(licen[cs]e.*disc|vehiclelicen[cs]e|disc.*expir)', false),
        ('windscreen', '(windscreen|windshield|frontscreen)', true),
        ('body', '(body|panel.*paint|exterior.*condition)', false),
        ('spare', 'spare(tyre|tire|wheel)', false),
        ('jack', '(^jack|vehiclejack|toolkit.*jack)', false),
        ('wheel_spanner', '(wheelspanner|wheelbrace|lugwrench|wheelwrench)', false),
        ('head_lights', '(headlight|headlamp|alllightsfunctional)', true),
        ('tail_lights', '(taillight|rearlight|alllightsfunctional)', true),
        ('indicators', '(indicator|turnsignal|hazardlight|signallight|alllightsfunctional)', true),
        ('reverse_light', '(reverselight|backuplight|alllightsfunctional)', true),
        ('fuel', '(fuellevel|fuel.*triprecord)', false),
        ('engine_oil', '(engineoil|oillevel)', true),
        ('coolant', '(coolant|waterlevel)', true),
        ('brake_fluid', 'brakefluid', true),
        ('clutch_fluid', 'clutchfluid', true),
        ('brakes', '(foot.*handbrake|service.*parkingbrake|brakeoperation|^brakes$)', true),
        ('horn', '(horn|hooter)', true),
        ('tyres', '(tyre|tire)', true),
        ('wipers', 'wiper', true),
        ('mirrors', 'mirror', true),
        ('key', '(^key$|vehiclekey|vehiclekeys|keys)', false)
    )
    SELECT
      EXISTS (
        SELECT 1
        FROM concepts c
        WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.n ~ c.matcher)
      )
      OR EXISTS (
        SELECT 1
        FROM concepts c
        JOIN existing e ON e.n ~ c.matcher
        WHERE c.critical = true AND e.is_critical = false
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

    -- Only one active template per tenant/type is permitted. Historical rows
    -- remain unchanged and continue to support completed inspection snapshots.
    UPDATE inspection_templates
    SET is_active = false, updated_at = now()
    WHERE id = template_row.id;

    INSERT INTO inspection_templates (tenant_id, name, type, version, is_active, created_at, updated_at)
    VALUES (template_row.tenant_id, template_row.name, template_row.type, new_version, true, now(), now())
    RETURNING id INTO new_template_id;

    -- Clone the existing working checklist first. Upgrade safety-equivalent
    -- checks to critical where a failure makes the vehicle unsafe to release.
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
        WHEN regexp_replace(lower(label), '[^a-z0-9]+', '', 'g') ~
          '(windscreen|windshield|frontscreen|headlight|headlamp|taillight|rearlight|indicator|turnsignal|hazardlight|signallight|alllightsfunctional|reverselight|backuplight|engineoil|oillevel|coolant|waterlevel|brakefluid|clutchfluid|foot.*handbrake|service.*parkingbrake|brakeoperation|^brakes$|horn|hooter|tyre|tire|wiper|mirror)'
          THEN true
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

    -- Any failed item makes overall_pass false, therefore even non-critical
    -- equipment/document failures prevent the current inspection from unlocking
    -- vehicle issue. Critical failures additionally create blocking defects and
    -- move the vehicle to maintenance via inspection-service.
    WITH physical_items(label, category, is_critical, matcher, ordinal) AS (
      VALUES
        ('Licence disc expiry date', 'documents', false, '(licen[cs]e.*disc|vehiclelicen[cs]e|disc.*expir)', 1),
        ('Windscreen / front screen', 'exterior', true, '(windscreen|windshield|frontscreen)', 2),
        ('Body condition', 'exterior', false, '(body|panel.*paint|exterior.*condition)', 3),
        ('Spare wheel', 'equipment', false, 'spare(tyre|tire|wheel)', 4),
        ('Jack', 'equipment', false, '(^jack|vehiclejack|toolkit.*jack)', 5),
        ('Wheel spanner', 'equipment', false, '(wheelspanner|wheelbrace|lugwrench|wheelwrench)', 6),
        ('Head lights', 'lights', true, '(headlight|headlamp|alllightsfunctional)', 7),
        ('Tail lights', 'lights', true, '(taillight|rearlight|alllightsfunctional)', 8),
        ('Indicator lights', 'lights', true, '(indicator|turnsignal|hazardlight|signallight|alllightsfunctional)', 9),
        ('Reverse light', 'lights', true, '(reverselight|backuplight|alllightsfunctional)', 10),
        ('Fuel level', 'fuel', false, '(fuellevel|fuel.*triprecord)', 11),
        ('Engine oil level', 'safety', true, '(engineoil|oillevel)', 12),
        ('Coolant / water level', 'safety', true, '(coolant|waterlevel)', 13),
        ('Brake fluid', 'safety', true, 'brakefluid', 14),
        ('Clutch fluid', 'safety', true, 'clutchfluid', 15),
        ('Foot & hand brakes', 'safety', true, '(foot.*handbrake|service.*parkingbrake|brakeoperation|^brakes$)', 16),
        ('Horn / hooter', 'safety', true, '(horn|hooter)', 17),
        ('Tyres', 'tyres', true, '(tyre|tire)', 18),
        ('Wipers', 'safety', true, 'wiper', 19),
        ('Mirrors', 'safety', true, 'mirror', 20),
        ('Vehicle key', 'equipment', false, '(^key$|vehiclekey|vehiclekeys|keys)', 21)
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
        AND regexp_replace(lower(i.label), '[^a-z0-9]+', '', 'g') ~ p.matcher
    )
    ORDER BY p.ordinal;
  END LOOP;
END $$;
