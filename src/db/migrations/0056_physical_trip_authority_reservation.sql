-- Transport Office may reserve the number printed on a physical Trip Authority
-- before final authorisation. The number remains optional; when absent the
-- canonical authority service generates the normal tenant/year sequence.
ALTER TABLE transport_requests
  ADD COLUMN IF NOT EXISTS physical_trip_authority_number text,
  ADD COLUMN IF NOT EXISTS physical_trip_authority_number_set_by_user_id text,
  ADD COLUMN IF NOT EXISTS physical_trip_authority_number_set_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_requests_tenant_physical_authority_number
  ON transport_requests (tenant_id, physical_trip_authority_number)
  WHERE physical_trip_authority_number IS NOT NULL;
