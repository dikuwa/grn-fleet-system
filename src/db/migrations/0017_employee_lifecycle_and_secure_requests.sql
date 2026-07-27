-- Employee lifecycle, acting delegations, secure staff request sessions and driver compliance.
-- Additive and history-preserving: no employee or request records are removed.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS initials text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS preferred_name text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS national_id_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS substantive_position text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS region_id uuid;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS directorate text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_employee_id uuid;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS alternative_phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_start_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_end_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'available';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_signatory boolean NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS profile_photo_url text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS archived_by_user_id text;

UPDATE employees SET employment_status = 'archived', archived_at = COALESCE(archived_at, updated_at)
WHERE employment_status = 'terminated';

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_status text NOT NULL DEFAULT 'temporary';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mfa_status text NOT NULL DEFAULT 'not_configured';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS account_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'official';
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS driving_restrictions text;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS preferred_vehicle_types text;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS suspension_reason text;
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS suspension_ends_at timestamptz;

ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS holder_name text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS national_id_number text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS issuing_authority text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS driver_restriction_code text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS issue_number text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS front_image_key text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS back_image_key text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS source_pdf_key text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS raw_ocr_result jsonb;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS ocr_confidence jsonb;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS ocr_provider text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS entry_method text NOT NULL DEFAULT 'manual';
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS verified_by_user_id text;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE driver_licences ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE transport_requests ALTER COLUMN requester_user_id DROP NOT NULL;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS entered_by_user_id text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS request_source text NOT NULL DEFAULT 'logged_in_self_service';
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS request_channel text NOT NULL DEFAULT 'dashboard';
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS submission_method text NOT NULL DEFAULT 'logged_in';
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS verification_method text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS assisted_reason text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS confirmation_method text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS employee_confirmation_status text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS public_tracking_token_hash text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS preferred_driver_employee_id uuid REFERENCES employees(id);
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS assigned_driver_employee_id uuid REFERENCES employees(id);
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS driver_preference text NOT NULL DEFAULT 'no_preference';
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS requesting_office_snapshot text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS approval_office_id uuid REFERENCES offices(id);
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS traveller_employee_id uuid REFERENCES employees(id);
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal';
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS overnight boolean NOT NULL DEFAULT false;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS special_requirements text;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS vehicle_requirements jsonb DEFAULT '{}'::jsonb;

UPDATE transport_requests
SET entered_by_user_id = requester_user_id,
    request_source = COALESCE(request_source, 'logged_in_self_service'),
    request_channel = COALESCE(request_channel, 'dashboard'),
    submission_method = COALESCE(submission_method, 'logged_in'),
    traveller_employee_id = COALESCE(traveller_employee_id, requester_employee_id);

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS required_licence_class text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS gross_vehicle_mass_category text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS trailer_requirement boolean NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS professional_authorisation_required boolean NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS special_restriction text;

CREATE TABLE IF NOT EXISTS employee_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  office_id uuid REFERENCES offices(id),
  region_id uuid,
  directorate text,
  department_id uuid REFERENCES departments(id),
  job_title text,
  position text,
  start_date date NOT NULL,
  end_date date,
  supervisor_employee_id uuid REFERENCES employees(id),
  reason text,
  created_by_user_id text NOT NULL,
  approved_by_user_id text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_current ON employee_assignments(tenant_id, employee_id, is_current);

INSERT INTO employee_assignments (
  tenant_id, employee_id, office_id, region_id, directorate, department_id,
  job_title, position, start_date, created_by_user_id, is_current
)
SELECT tenant_id, id, office_id, region_id, directorate, department_id,
       job_title, substantive_position, COALESCE(employment_start_date, created_at::date),
       COALESCE(user_id, 'system:migration'), true
FROM employees
WHERE NOT EXISTS (SELECT 1 FROM employee_assignments ea WHERE ea.employee_id = employees.id);

CREATE TABLE IF NOT EXISTS employee_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  status text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  reason text,
  notes text,
  supporting_document_key text,
  entered_by_user_id text NOT NULL,
  approved_by_user_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_availability_active ON employee_availability(tenant_id, employee_id, is_active, start_at, end_at);

CREATE TABLE IF NOT EXISTS role_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organisational_unit text,
  role_id uuid NOT NULL REFERENCES roles(id),
  substantive_holder_employee_id uuid REFERENCES employees(id),
  acting_employee_id uuid NOT NULL REFERENCES employees(id),
  acting_title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  reason text NOT NULL,
  approval_authority text,
  can_approve boolean NOT NULL DEFAULT false,
  can_sign boolean NOT NULL DEFAULT false,
  can_allocate_vehicles boolean NOT NULL DEFAULT false,
  can_assign_drivers boolean NOT NULL DEFAULT false,
  can_reconcile_trips boolean NOT NULL DEFAULT false,
  can_delegate_further boolean NOT NULL DEFAULT false,
  appointment_memo_key text,
  created_by_user_id text NOT NULL,
  authorised_by_user_id text,
  status text NOT NULL DEFAULT 'scheduled',
  revoked_at timestamptz,
  revoked_by_user_id text,
  revocation_reason text,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_role_delegations_resolution ON role_delegations(tenant_id, role_id, start_at, end_at, status);
CREATE INDEX IF NOT EXISTS idx_role_delegations_acting ON role_delegations(tenant_id, acting_employee_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS signatory_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id),
  organisational_unit text,
  fallback_role_ids jsonb DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  proposed_changes jsonb NOT NULL,
  source text NOT NULL DEFAULT 'secure_request',
  status text NOT NULL DEFAULT 'pending',
  reviewed_by_user_id text,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS secure_request_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),
  identity_hash text NOT NULL,
  otp_hash text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  destination_masked text,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  request_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_secure_verification_identity ON secure_request_verifications(tenant_id, identity_hash, created_at);

CREATE TABLE IF NOT EXISTS secure_request_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  verification_id uuid NOT NULL REFERENCES secure_request_verifications(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS driver_licence_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id uuid NOT NULL REFERENCES driver_licences(id) ON DELETE CASCADE,
  code text NOT NULL,
  first_issue_date date,
  vehicle_restriction text,
  is_active boolean NOT NULL DEFAULT true,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_driver_licence_codes_licence ON driver_licence_codes(licence_id, is_active);

CREATE TABLE IF NOT EXISTS driver_professional_authorisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id uuid NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  category text NOT NULL,
  category_type text,
  valid_from date,
  expiry_date date NOT NULL,
  restrictions text,
  is_verified boolean NOT NULL DEFAULT false,
  verified_by_user_id text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS driver_licence_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id uuid NOT NULL REFERENCES driver_licences(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  original_value text,
  corrected_value text,
  corrected_by_user_id text,
  source text NOT NULL DEFAULT 'review',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_default_directory ON employees(tenant_id, employment_status, last_name);
CREATE INDEX IF NOT EXISTS idx_requests_submission_method ON transport_requests(tenant_id, submission_method, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_requests_public_tracking_token ON transport_requests(public_tracking_token_hash) WHERE public_tracking_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_licences_active_expiry ON driver_licences(driver_profile_id, is_active, expiry_date);

INSERT INTO permissions (code, name, description, "group")
VALUES
  ('staff:lifecycle-manage', 'Manage employee lifecycle', 'Archive, restore, transfer and manage availability', 'staff'),
  ('delegation:manage', 'Manage acting roles', 'Create, authorise and revoke acting appointments', 'staff'),
  ('driver:licence-verify', 'Verify driver licences', 'Review OCR and verify sensitive driver licence records', 'drivers'),
  ('request:assist', 'Submit assisted requests', 'Submit a transport request on behalf of an employee', 'requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('Tenant Administrator', 'Transport Administrator')
  AND p.code IN ('staff:lifecycle-manage', 'delegation:manage', 'driver:licence-verify', 'request:assist')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_code = p.code
  );
