-- Enforce one active approval workflow per transport request.
--
-- Historical workflow instances remain untouched. If legacy data contains more
-- than one active instance for the same request, preserve the instance already
-- linked from transport_requests.workflow_instance_id when possible; otherwise
-- preserve the most recently updated instance. Extra active rows are cancelled
-- rather than deleted so their actions/audit history remain available.

WITH ranked_active AS (
  SELECT
    wi.id,
    wi.request_id,
    ROW_NUMBER() OVER (
      PARTITION BY wi.request_id
      ORDER BY
        CASE WHEN tr.workflow_instance_id = wi.id THEN 0 ELSE 1 END,
        wi.updated_at DESC,
        wi.created_at DESC,
        wi.id DESC
    ) AS rn
  FROM workflow_instances wi
  INNER JOIN transport_requests tr ON tr.id = wi.request_id
  WHERE wi.status = 'active'
)
UPDATE workflow_instances wi
SET
  status = 'cancelled',
  current_assigned_user_id = NULL,
  current_assignment_meta = '{}'::jsonb,
  updated_at = now()
FROM ranked_active ranked
WHERE wi.id = ranked.id
  AND ranked.rn > 1;

-- Repair stale/missing request pointers to the one surviving active instance.
WITH surviving_active AS (
  SELECT DISTINCT ON (wi.request_id)
    wi.request_id,
    wi.id
  FROM workflow_instances wi
  WHERE wi.status = 'active'
  ORDER BY wi.request_id, wi.updated_at DESC, wi.created_at DESC, wi.id DESC
)
UPDATE transport_requests tr
SET
  workflow_instance_id = surviving.id,
  updated_at = now()
FROM surviving_active surviving
WHERE tr.id = surviving.request_id
  AND tr.workflow_instance_id IS DISTINCT FROM surviving.id;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_instances_one_active_per_request
  ON workflow_instances (request_id)
  WHERE status = 'active';
