-- 0037_mva_report_columns.sql
-- Motor Vehicle Accident (MVA) report columns for trip_incidents

ALTER TABLE trip_incidents
  ADD COLUMN IF NOT EXISTS accident_report_number TEXT,
  ADD COLUMN IF NOT EXISTS investigation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS insurance_claim_reference TEXT,
  ADD COLUMN IF NOT EXISTS insurance_notified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS insurance_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS police_report_filed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS third_party_insurance_details JSONB,
  ADD COLUMN IF NOT EXISTS witness_statements JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS investigation_notes TEXT,
  ADD COLUMN IF NOT EXISTS investigation_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS technical_clearance_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS technical_clearance_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS technical_clearance_by_user_id TEXT;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trip_incidents_tenant_mva ON trip_incidents(tenant_id, accident_report_number) WHERE accident_report_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trip_incidents_investigation_status ON trip_incidents(tenant_id, investigation_status);
CREATE INDEX IF NOT EXISTS idx_trip_incidents_technical_clearance ON trip_incidents(tenant_id, technical_clearance_status);
CREATE INDEX IF NOT EXISTS idx_trip_incidents_insurance_notified ON trip_incidents(tenant_id, insurance_notified) WHERE insurance_notified = TRUE;