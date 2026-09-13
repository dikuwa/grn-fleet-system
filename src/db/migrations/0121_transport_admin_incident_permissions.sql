-- 0121_transport_admin_incident_permissions.sql
-- Keep the Transport Administrator system role aligned with the dedicated
-- Incident/MVA capabilities enforced by the current UI and API boundaries.
--
-- Notification dedupe migrations now occupy 0119-0120. This insert-only
-- migration backfills the five dedicated incident capabilities into existing
-- system Transport Administrator roles without deleting or changing custom
-- role permissions. Idempotent on re-run.

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