-- Convert legacy single-string driver licence classes into configurable code rows
-- and initialise signatory positions from existing permission-bearing roles.

INSERT INTO driver_licence_codes (licence_id, code, is_active)
SELECT dl.id, trim(code), true
FROM driver_licences dl
CROSS JOIN LATERAL regexp_split_to_table(dl.licence_class, '[,;/ ]+') AS code
WHERE trim(code) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM driver_licence_codes existing
    WHERE existing.licence_id = dl.id AND upper(existing.code) = upper(trim(code))
  );

INSERT INTO signatory_positions (tenant_id, name, role_id, is_active)
SELECT r.tenant_id, r.name, r.id, true
FROM roles r
WHERE EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = r.id
    AND rp.permission_code IN (
      'request:approve-supervisor',
      'vehicle:release-regional',
      'vehicle:release-national',
      'trip:authorize-regional',
      'trip:authorize-national'
    )
)
AND NOT EXISTS (
  SELECT 1 FROM signatory_positions sp
  WHERE sp.tenant_id = r.tenant_id AND sp.role_id = r.id
);
