CREATE TABLE legal_policy_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  instrument_type text NOT NULL,
  citation text NOT NULL,
  source_url text,
  status text NOT NULL DEFAULT 'in_force',
  effective_date date,
  applicability text NOT NULL,
  responsible_office text,
  review_due_date date,
  notes text,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_policy_register_status_check
    CHECK (status IN ('in_force', 'uncommenced', 'repealed', 'internal_policy'))
);

CREATE UNIQUE INDEX legal_policy_register_tenant_citation_unique
  ON legal_policy_register (tenant_id, citation);
CREATE INDEX legal_policy_register_tenant_status_idx
  ON legal_policy_register (tenant_id, status);
CREATE INDEX legal_policy_register_review_due_idx
  ON legal_policy_register (tenant_id, review_due_date);

INSERT INTO permissions (code, name, description, "group")
VALUES
  ('legalPolicy:view', 'View Legal & Policy Register', 'View the tenant legal and policy register', 'audit'),
  ('legalPolicy:manage', 'Manage Legal & Policy Register', 'Create and maintain tenant legal and policy register entries', 'audit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, mapping.permission_code
FROM roles r
JOIN (
  VALUES
    ('Tenant Administrator', 'legalPolicy:view'),
    ('Tenant Administrator', 'legalPolicy:manage'),
    ('Tenant Auditor', 'legalPolicy:view'),
    ('Platform Super Administrator', 'legalPolicy:view'),
    ('Platform Super Administrator', 'legalPolicy:manage'),
    ('Platform Auditor', 'legalPolicy:view')
) AS mapping(role_name, permission_code) ON mapping.role_name = r.name
JOIN permissions p ON p.code = mapping.permission_code
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions existing
  WHERE existing.role_id = r.id
    AND existing.permission_code = mapping.permission_code
);

INSERT INTO legal_policy_register (
  tenant_id,
  title,
  instrument_type,
  citation,
  source_url,
  status,
  effective_date,
  applicability,
  notes
)
SELECT
  t.id,
  'Road Traffic and Transport Act, 1999',
  'Act',
  'Act 22 of 1999',
  'https://namiblii.org/akn/na/act/1999/22/eng@2008-12-09',
  'in_force',
  NULL,
  'Statutory framework for road traffic, vehicle and transport operations in Namibia.',
  'Verify the current consolidated text and applicable regulations when conducting a legal review.'
FROM tenants t
ON CONFLICT (tenant_id, citation) DO NOTHING;

INSERT INTO legal_policy_register (
  tenant_id,
  title,
  instrument_type,
  citation,
  source_url,
  status,
  effective_date,
  applicability,
  notes
)
SELECT
  t.id,
  'Road Traffic and Transport Amendment Act, 2008',
  'Amendment Act',
  'Act 6 of 2008',
  'https://namiblii.org/akn/na/act/2008/6/eng@2008-12-09',
  'in_force',
  DATE '2008-12-09',
  'Amendments applicable to the Road Traffic and Transport Act, 1999.',
  'Retained as a separate register entry so amendments remain visible and reviewable.'
FROM tenants t
ON CONFLICT (tenant_id, citation) DO NOTHING;
