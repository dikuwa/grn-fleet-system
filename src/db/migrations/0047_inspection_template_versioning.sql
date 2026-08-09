-- Repair legacy inspection-template versioning before enforcing invariants.
-- Older API writes created every template as version 1 and could leave multiple
-- active rows for the same tenant/type. Preserve chronological history by
-- assigning deterministic versions, then keep only the newest version active.

WITH numbered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, type
      ORDER BY created_at ASC, id ASC
    )::integer AS new_version
  FROM inspection_templates
)
UPDATE inspection_templates AS template
SET version = numbered.new_version
FROM numbered
WHERE template.id = numbered.id
  AND template.version IS DISTINCT FROM numbered.new_version;

-- Keep inspection snapshots aligned with their referenced template after the
-- one-time legacy renumbering above.
UPDATE vehicle_inspections AS inspection
SET template_version = template.version
FROM inspection_templates AS template
WHERE inspection.template_id = template.id
  AND inspection.template_version IS DISTINCT FROM template.version;

WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, type
      ORDER BY version DESC, updated_at DESC, id DESC
    ) AS active_rank
  FROM inspection_templates
  WHERE is_active = true
)
UPDATE inspection_templates AS template
SET is_active = false,
    updated_at = now()
FROM ranked_active
WHERE template.id = ranked_active.id
  AND ranked_active.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_templates_tenant_type_version
  ON inspection_templates (tenant_id, type, version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_templates_one_active
  ON inspection_templates (tenant_id, type)
  WHERE is_active = true;
