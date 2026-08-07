-- 0036_emergency_contacts.sql
-- Cached emergency contacts per tenant and region

CREATE TABLE IF NOT EXISTS emergency_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name text NOT NULL,
    phone text NOT NULL,
    role text NOT NULL, -- hospital, police, towing, fire, insurance, internal
    region text,        -- nullable; NULL means available for all regions
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_emergency_contacts_tenant_phone UNIQUE (tenant_id, phone, role)
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_tenant_active
    ON emergency_contacts (tenant_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_tenant_region
    ON emergency_contacts (tenant_id, region);
