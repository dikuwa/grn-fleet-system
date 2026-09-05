-- Department and office codes are tenant-local routing/reference identifiers.
-- Application pre-checks are friendly UX only; concurrent create/rename writes
-- still need a database invariant. Production was checked before this migration
-- and currently contains no duplicate normalized tenant codes.

CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_tenant_code_normalized
  ON departments (tenant_id, upper(btrim(code)))
  WHERE code IS NOT NULL AND btrim(code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_offices_tenant_code_normalized
  ON offices (tenant_id, upper(btrim(code)))
  WHERE code IS NOT NULL AND btrim(code) <> '';
