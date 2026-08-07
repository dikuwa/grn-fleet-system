-- 0037_incident_categories.sql
-- Tenant-configurable incident categories

CREATE TABLE IF NOT EXISTS incident_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code text NOT NULL, -- internal code, unique per tenant
    name text NOT NULL, -- display name
    "group" text NOT NULL, -- vehicle, route_safety, security, other
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    requires_mva_form boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_incident_categories_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_incident_categories_tenant_active
    ON incident_categories (tenant_id, is_active) WHERE is_active = true;

-- Add incident_category_code column to trip_incidents
ALTER TABLE trip_incidents ADD COLUMN IF NOT EXISTS incident_category_code text;
CREATE INDEX IF NOT EXISTS idx_trip_incidents_category_code ON trip_incidents (incident_category_code);

-- Default categories seed for existing tenants (optional - can be done in onboarding)
-- This is handled by the onboarding/setup wizard, but we provide the default data here for reference.
-- The categories will be inserted per-tenant during tenant setup.