-- Canonical digital Trip Authority, mobile trip operations, reconciliation and OCR audit.
-- Additive migration: existing request/allocation/trip records are preserved and backfilled.

ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS trip_id uuid;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS authority_number text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS verification_token_hash text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS valid_from timestamptz;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS approved_route text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS special_conditions text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS beginning_odometer integer;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS ending_odometer integer;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS accepted_by_employee_id uuid REFERENCES employees(id);
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS acceptance_data jsonb;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS issued_at timestamptz;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS authorised_at timestamptz;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS authorised_by_user_id text;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS authoriser_snapshot jsonb;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE trip_authorities ADD COLUMN IF NOT EXISTS cancellation_reason text;

UPDATE trip_authorities ta
SET tenant_id = tr.tenant_id,
    trip_id = tr.id,
    valid_from = COALESCE(ta.valid_from, va.start_at),
    valid_until = COALESCE(ta.valid_until, va.end_at),
    issued_at = COALESCE(ta.issued_at, ta.created_at),
    purpose = COALESCE(ta.purpose, req.purpose)
FROM transport_requests req
JOIN vehicle_allocations va ON va.request_id = req.id
LEFT JOIN trips tr ON tr.allocation_id = va.id
WHERE ta.request_id = req.id
  AND ta.allocation_id = va.id;

WITH numbered AS (
  SELECT ta.id,
         'TA-' || EXTRACT(YEAR FROM COALESCE(ta.issued_at, ta.created_at))::int || '-' ||
         UPPER(regexp_replace(COALESCE(t.code, 'GRN'), '[^A-Za-z0-9]', '', 'g')) || '-' ||
         LPAD(ROW_NUMBER() OVER (
           PARTITION BY ta.tenant_id, EXTRACT(YEAR FROM COALESCE(ta.issued_at, ta.created_at))
           ORDER BY ta.created_at, ta.id
         )::text, 6, '0') AS authority_number
  FROM trip_authorities ta
  LEFT JOIN tenants t ON t.id = ta.tenant_id
  WHERE ta.authority_number IS NULL
)
UPDATE trip_authorities ta
SET authority_number = numbered.authority_number
FROM numbered
WHERE ta.id = numbered.id;

DO $$ BEGIN
  ALTER TABLE trip_authorities
    ADD CONSTRAINT trip_authorities_trip_id_trips_id_fk
    FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_authorities_tenant_number ON trip_authorities(tenant_id, authority_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_authorities_trip ON trip_authorities(trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_authorities_verification_hash ON trip_authorities(verification_token_hash);
CREATE INDEX IF NOT EXISTS idx_trip_authorities_tenant_status ON trip_authorities(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_trip_authorities_request ON trip_authorities(request_id);

CREATE TABLE IF NOT EXISTS trip_authority_sequences (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_year integer NOT NULL,
  current_value integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_authority_sequence_tenant_year
  ON trip_authority_sequences(tenant_id, sequence_year);

INSERT INTO trip_authority_sequences (tenant_id, sequence_year, current_value)
SELECT tenant_id,
       EXTRACT(YEAR FROM COALESCE(issued_at, created_at))::int,
       COUNT(*)::int
FROM trip_authorities
WHERE tenant_id IS NOT NULL
GROUP BY tenant_id, EXTRACT(YEAR FROM COALESCE(issued_at, created_at))
ON CONFLICT (tenant_id, sequence_year)
DO UPDATE SET current_value = GREATEST(trip_authority_sequences.current_value, EXCLUDED.current_value);

CREATE TABLE IF NOT EXISTS trip_authority_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES trip_authorities(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL,
  snapshot jsonb NOT NULL,
  generated_document_id uuid,
  reason text,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_authority_versions_authority_version
  ON trip_authority_versions(authority_id, version);

CREATE TABLE IF NOT EXISTS trip_authority_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES trip_authorities(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),
  full_name text NOT NULL,
  employee_number text,
  office_or_department text,
  contact_number text,
  passenger_type text NOT NULL DEFAULT 'government_employee',
  boarding_point text,
  destination text,
  reason_for_travel text,
  indemnity_required boolean NOT NULL DEFAULT false,
  indemnity_confirmed boolean NOT NULL DEFAULT false,
  indemnity_document_key text,
  approval_status text NOT NULL DEFAULT 'approved',
  added_by_user_id text NOT NULL,
  removed_at timestamptz,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_authority_passengers_authority
  ON trip_authority_passengers(authority_id);

CREATE TABLE IF NOT EXISTS trip_authorised_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES trip_authorities(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  driver_type text NOT NULL DEFAULT 'additional',
  employee_number text,
  licence_number_masked text,
  licence_class text,
  licence_expiry timestamptz,
  reason text,
  authorised_by_user_id text,
  authorised_at timestamptz,
  takeover_odometer integer,
  handover_odometer integer,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_authorised_drivers_authority_employee
  ON trip_authorised_drivers(authority_id, employee_id);

CREATE TABLE IF NOT EXISTS trip_progress_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  client_sync_id text,
  entry_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  location text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  odometer_reading integer,
  note text,
  route_deviation_reason text,
  prior_approval_obtained boolean,
  attachment_key text,
  created_by_user_id text NOT NULL,
  offline_created_at timestamptz,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_progress_tenant_sync
  ON trip_progress_entries(tenant_id, client_sync_id);
CREATE INDEX IF NOT EXISTS idx_trip_progress_trip_occurred
  ON trip_progress_entries(trip_id, occurred_at);

CREATE TABLE IF NOT EXISTS trip_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  client_sync_id text,
  category text NOT NULL,
  supplier text,
  transaction_at timestamptz NOT NULL,
  reference_number text,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'NAD',
  odometer_reading integer,
  receipt_key text,
  verification_status text NOT NULL DEFAULT 'awaiting_verification',
  notes text,
  entered_by_user_id text NOT NULL,
  verified_by_user_id text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_expenses_tenant_sync
  ON trip_expenses(tenant_id, client_sync_id);
CREATE INDEX IF NOT EXISTS idx_trip_expenses_trip ON trip_expenses(trip_id);

CREATE TABLE IF NOT EXISTS trip_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  client_sync_id text,
  incident_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  location text,
  odometer_reading integer,
  description text NOT NULL,
  injuries boolean NOT NULL DEFAULT false,
  vehicle_damage boolean NOT NULL DEFAULT false,
  third_party_involvement boolean NOT NULL DEFAULT false,
  police_reference text,
  emergency_services_contacted boolean NOT NULL DEFAULT false,
  safe_to_continue boolean NOT NULL DEFAULT true,
  action_taken text,
  attachment_keys jsonb DEFAULT '[]'::jsonb,
  administrator_response text,
  status text NOT NULL DEFAULT 'reported',
  reported_by_user_id text NOT NULL,
  offline_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_incidents_tenant_sync
  ON trip_incidents(tenant_id, client_sync_id);
CREATE INDEX IF NOT EXISTS idx_trip_incidents_trip_status ON trip_incidents(trip_id, status);

CREATE TABLE IF NOT EXISTS trip_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES trip_authorities(id) ON DELETE CASCADE,
  amendment_type text NOT NULL,
  original_value jsonb,
  new_value jsonb NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by_user_id text NOT NULL,
  approved_by_user_id text,
  approved_at timestamptz,
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_amendments_authority ON trip_amendments(authority_id);

ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS original_file_name text;
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS file_size integer;
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS checksum text;
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS ocr_status text NOT NULL DEFAULT 'awaiting_ocr';
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS raw_ocr_response jsonb;
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS field_confidence jsonb;
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS verified_by_user_id text;
ALTER TABLE fuel_receipts ADD COLUMN IF NOT EXISTS verified_at timestamptz;

UPDATE fuel_receipts fr
SET tenant_id = tr.tenant_id
FROM fuel_transactions ft
JOIN trips tr ON tr.id = ft.trip_id
WHERE fr.transaction_id = ft.id
  AND fr.tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_receipts_tenant_checksum
  ON fuel_receipts(tenant_id, checksum);
CREATE INDEX IF NOT EXISTS idx_fuel_receipts_ocr_status ON fuel_receipts(ocr_status);

CREATE TABLE IF NOT EXISTS receipt_field_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES fuel_receipts(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  extracted_value text,
  corrected_value text NOT NULL,
  corrected_by_user_id text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipt_field_corrections_receipt
  ON receipt_field_corrections(receipt_id);

-- Existing driver role assignments gain the operational permissions required by the mobile workflow.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
JOIN permissions p ON p.code IN ('inspection:perform', 'file:upload')
WHERE r.name IN ('Assigned Driver', 'Driver')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_code = p.code
  );
