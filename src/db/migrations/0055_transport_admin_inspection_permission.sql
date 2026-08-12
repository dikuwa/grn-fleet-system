-- Transport Administrators are operationally responsible for vehicle issue readiness
-- and may perform the official departure/return inspection themselves.
INSERT INTO role_permissions (id, role_id, permission_code)
SELECT gen_random_uuid(), r.id, 'inspection:perform'
FROM roles r
WHERE r.name = 'Transport Administrator'
  AND r.is_system = true
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_code = 'inspection:perform'
  );
