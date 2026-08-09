-- Reconcile legacy split Driver Acknowledgements created before the Driver
-- Console and workflow acknowledgement paths were unified.
--
-- The legacy trip endpoint could mark both the trip and Trip Authority accepted
-- without completing the workflow. Repair only instances whose *configured
-- current step* is acknowledgement and whose persisted trip/authority already
-- prove that the assigned driver accepted the trip.

WITH candidates AS (
  SELECT DISTINCT ON (wi.id)
    wi.id AS instance_id,
    wi.request_id,
    wi.current_step_order,
    tr.tenant_id,
    t.driver_acknowledged_by_employee_id AS employee_id,
    e.user_id,
    COALESCE(ta.acceptance_data, '{}'::jsonb) AS acceptance_data,
    COALESCE(t.driver_acknowledged_at, ta.accepted_at, now()) AS acknowledged_at
  FROM workflow_instances wi
  INNER JOIN workflow_steps ws
    ON ws.definition_id = wi.definition_id
   AND ws.step_order = wi.current_step_order
   AND ws.action_type = 'acknowledge'
  INNER JOIN transport_requests tr ON tr.id = wi.request_id
  INNER JOIN trips t ON t.request_id = wi.request_id
  INNER JOIN trip_authorities ta
    ON ta.trip_id = t.id
   AND ta.request_id = wi.request_id
  INNER JOIN employees e
    ON e.id = t.driver_acknowledged_by_employee_id
   AND e.tenant_id = tr.tenant_id
  WHERE wi.status = 'active'
    AND t.driver_acknowledged_at IS NOT NULL
    AND ta.status = 'driver_accepted'
    AND ta.accepted_by_employee_id = t.driver_acknowledged_by_employee_id
    AND e.user_id IS NOT NULL
  ORDER BY wi.id, t.driver_acknowledged_at DESC
),
actions_inserted AS (
  INSERT INTO workflow_actions (
    instance_id,
    step_order,
    action_type,
    result,
    actor_user_id,
    actor_employee_id,
    comment,
    metadata,
    created_at
  )
  SELECT
    c.instance_id,
    c.current_step_order,
    'acknowledge',
    'acknowledged',
    c.user_id,
    c.employee_id,
    'Reconciled from previously recorded Driver Console acceptance',
    c.acceptance_data || jsonb_build_object('reconciledByMigration', '0048'),
    c.acknowledged_at
  FROM candidates c
  ON CONFLICT (instance_id, step_order) DO NOTHING
  RETURNING instance_id
),
completed AS (
  UPDATE workflow_instances wi
  SET status = 'completed',
      updated_at = now()
  FROM candidates c
  WHERE wi.id = c.instance_id
    AND wi.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM workflow_actions wa
      WHERE wa.instance_id = wi.id
        AND wa.step_order = c.current_step_order
        AND wa.action_type = 'acknowledge'
        AND wa.result = 'acknowledged'
    )
  RETURNING wi.id, wi.request_id
),
requests_updated AS (
  UPDATE transport_requests tr
  SET status = 'authorised',
      updated_at = now()
  FROM completed c
  WHERE tr.id = c.request_id
  RETURNING tr.id
)
INSERT INTO audit_events (
  tenant_id,
  tenant_sequence,
  event_type,
  actor_user_id,
  actor_employee_id,
  action,
  entity_type,
  entity_id,
  correlation_id,
  source_channel,
  summary,
  after,
  created_at
)
SELECT
  c.tenant_id,
  (extract(epoch from clock_timestamp()) * 1000000)::bigint +
    row_number() OVER (ORDER BY c.instance_id),
  'workflow_acknowledgement_reconciled',
  c.user_id,
  c.employee_id,
  'workflow.acknowledgement.reconcile',
  'workflow_action',
  c.instance_id,
  c.instance_id::text,
  'migration',
  'Reconciled legacy Driver Console acceptance with the workflow state',
  jsonb_build_object(
    'requestId', c.request_id,
    'stepOrder', c.current_step_order,
    'migration', '0048_reconcile_driver_acknowledgement'
  ),
  now()
FROM candidates c
WHERE EXISTS (SELECT 1 FROM completed done WHERE done.id = c.instance_id);
