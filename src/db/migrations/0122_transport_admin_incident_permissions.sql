-- 0122_transport_admin_incident_permissions.sql
-- Keep the Transport Administrator system role aligned with the dedicated
-- Incident/MVA capabilities enforced by the current UI and API boundaries.
--
-- 0119-0121 are intentionally left available for the in-flight notification
-- migration sequence. Earlier role synchronization guaranteed the broad
-- tripIncident:manage grant and catalogued the dedicated incident permissions,
-- but the Transport Administrator role baseline did not include those dedicated
-- grants. This insert-only migration backfills existing tenant roles without
-- deleting or changing custom role permissions. Idempotent on re-run.

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN (
  VALUES
    ('incident:complete-details'),
    ('incident:investigate'),
    ('incident:close-investigation'),
    ('incident:technical-clearance'),
    ('incident:insurance-update')
) AS p(code)
WHERE r.name = 'Transport Administrator'
  AND r.is_system = true
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions existing
    WHERE existing.role_id = r.id
      AND existing.permission_code = p.code
  );
