-- Ensure each tenant has at most one active workflow definition for an exact
-- trip/region/office/department routing scope. Historical inactive versions
-- remain untouched so existing workflow instances keep their definition links.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        tenant_id,
        trip_scope,
        COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(office_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY version DESC, updated_at DESC, created_at DESC, id DESC
    ) AS route_rank
  FROM workflow_definitions
  WHERE is_active = true
)
UPDATE workflow_definitions wd
SET is_active = false, updated_at = now()
FROM ranked r
WHERE wd.id = r.id
  AND r.route_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_definitions_one_active_per_route
ON workflow_definitions (
  tenant_id,
  trip_scope,
  COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(office_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE is_active = true;
