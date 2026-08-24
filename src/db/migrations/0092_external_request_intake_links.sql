-- Governed public intake links for genuine external transport requesters.
-- Links are tenant-bound, sponsor-bound and store only a one-way token hash.

CREATE TABLE IF NOT EXISTS request_intake_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sponsor_employee_id uuid NOT NULL REFERENCES employees(id),
  token_hash text NOT NULL,
  label text,
  trip_scope text NOT NULL DEFAULT 'regional',
  expires_at timestamptz NOT NULL,
  max_submissions integer NOT NULL DEFAULT 1,
  submission_count integer NOT NULL DEFAULT 0,
  last_submitted_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id text,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_request_intake_links_scope CHECK (trip_scope IN ('regional', 'national')),
  CONSTRAINT chk_request_intake_links_max_submissions CHECK (max_submissions BETWEEN 1 AND 1000),
  CONSTRAINT chk_request_intake_links_submission_count CHECK (submission_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_request_intake_links_token_hash
  ON request_intake_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_request_intake_links_tenant_created
  ON request_intake_links(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_intake_links_sponsor
  ON request_intake_links(tenant_id, sponsor_employee_id);
