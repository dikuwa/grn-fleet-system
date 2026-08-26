-- Extend the existing tenant workflow engine with governed request-routing
-- criteria. Existing definitions remain wildcard routes because null means
-- "any" for each new condition.

ALTER TABLE transport_requests
  ADD COLUMN IF NOT EXISTS request_origin text,
  ADD COLUMN IF NOT EXISTS financial_impact text,
  ADD COLUMN IF NOT EXISTS trip_category text,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS cost_centre text,
  ADD COLUMN IF NOT EXISTS funding_source text,
  ADD COLUMN IF NOT EXISTS budget_reference text;

UPDATE transport_requests
SET request_origin = CASE
  WHEN programme_id IS NOT NULL THEN 'programme'
  WHEN requester_type = 'external' THEN 'external'
  ELSE 'internal'
END
WHERE request_origin IS NULL;

UPDATE transport_requests SET financial_impact = 'none' WHERE financial_impact IS NULL;
UPDATE transport_requests SET trip_category = 'general' WHERE trip_category IS NULL;
UPDATE transport_requests SET currency = 'NAD' WHERE currency IS NULL;

ALTER TABLE transport_requests
  ALTER COLUMN request_origin SET DEFAULT 'internal',
  ALTER COLUMN request_origin SET NOT NULL,
  ALTER COLUMN financial_impact SET DEFAULT 'none',
  ALTER COLUMN financial_impact SET NOT NULL,
  ALTER COLUMN trip_category SET DEFAULT 'general',
  ALTER COLUMN trip_category SET NOT NULL,
  ALTER COLUMN currency SET DEFAULT 'NAD',
  ALTER COLUMN currency SET NOT NULL;

ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS request_origin text,
  ADD COLUMN IF NOT EXISTS financial_impact text,
  ADD COLUMN IF NOT EXISTS trip_category text;

ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS routing_context jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP INDEX IF EXISTS workflow_definitions_one_active_per_route;

CREATE UNIQUE INDEX workflow_definitions_one_active_per_route
ON workflow_definitions (
  tenant_id,
  trip_scope,
  COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(office_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(request_origin, '__any__'),
  COALESCE(financial_impact, '__any__'),
  COALESCE(trip_category, '__any__')
)
WHERE is_active = true;

ALTER TABLE transport_requests
  ADD CONSTRAINT transport_requests_request_origin_check
    CHECK (request_origin IN ('internal', 'external', 'programme')),
  ADD CONSTRAINT transport_requests_financial_impact_check
    CHECK (financial_impact IN ('none', 'within_budget', 'additional_funding')),
  ADD CONSTRAINT transport_requests_currency_nad_check
    CHECK (currency = 'NAD'),
  ADD CONSTRAINT transport_requests_estimated_cost_check
    CHECK (estimated_cost IS NULL OR estimated_cost >= 0);

ALTER TABLE workflow_definitions
  ADD CONSTRAINT workflow_definitions_request_origin_check
    CHECK (request_origin IS NULL OR request_origin IN ('internal', 'external', 'programme')),
  ADD CONSTRAINT workflow_definitions_financial_impact_check
    CHECK (financial_impact IS NULL OR financial_impact IN ('none', 'within_budget', 'additional_funding'));

-- Governed stage permissions and system-role reconciliation for existing
-- tenants. Insert-only operations preserve custom role grants.
INSERT INTO permissions (code, name, description, "group")
VALUES
  ('request:approve-organisational', 'Approve Organisational Request', 'Approve transport requests as the responsible Director, Sponsor or equivalent authority', 'request'),
  ('request:review-finance', 'Review Request Budget', 'Review and record the financial or budget impact of a transport request', 'request')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (tenant_id, name, description, is_system)
SELECT
  t.id,
  'Finance / Budget Reviewer',
  'Reviews transport-request financial impact and records governed budget decisions.',
  true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM roles r
  WHERE r.tenant_id = t.id AND r.name = 'Finance / Budget Reviewer'
);

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, mapping.permission_code
FROM roles r
JOIN (
  VALUES
    ('Finance / Budget Reviewer', 'request:view'),
    ('Finance / Budget Reviewer', 'request:review-finance'),
    ('Finance / Budget Reviewer', 'report:view'),
    ('Finance / Budget Reviewer', 'file:view'),
    ('Director', 'request:approve-organisational')
) AS mapping(role_name, permission_code) ON mapping.role_name = r.name
JOIN permissions p ON p.code = mapping.permission_code
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions existing
  WHERE existing.role_id = r.id
    AND existing.permission_code = mapping.permission_code
);
