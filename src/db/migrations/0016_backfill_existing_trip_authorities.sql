-- Give every legacy operational trip a canonical authority without changing its lifecycle.
WITH missing AS (
  SELECT tr.id AS trip_id,
         tr.tenant_id,
         tr.request_id,
         tr.allocation_id,
         tr.status AS trip_status,
         tr.created_at,
         va.start_at,
         va.end_at,
         req.reference,
         req.purpose,
         req.special_authority_approved,
         req.special_authority_reason,
         req.total_authorised_kilometres,
         t.code AS tenant_code,
         ROW_NUMBER() OVER (
           PARTITION BY tr.tenant_id, EXTRACT(YEAR FROM va.start_at)
           ORDER BY tr.created_at, tr.id
         ) AS row_number
  FROM trips tr
  JOIN vehicle_allocations va ON va.id = tr.allocation_id
  JOIN transport_requests req ON req.id = tr.request_id
  JOIN tenants t ON t.id = tr.tenant_id
  LEFT JOIN trip_authorities ta ON ta.trip_id = tr.id
  WHERE ta.id IS NULL
),
base AS (
  SELECT tenant_id,
         sequence_year,
         current_value
  FROM trip_authority_sequences
)
INSERT INTO trip_authorities (
  tenant_id,
  trip_id,
  request_id,
  allocation_id,
  authority_number,
  status,
  version,
  valid_from,
  valid_until,
  purpose,
  special_authority_granted,
  special_conditions,
  issued_at,
  document_version,
  data,
  created_at,
  updated_at
)
SELECT m.tenant_id,
       m.trip_id,
       m.request_id,
       m.allocation_id,
       'TA-' || EXTRACT(YEAR FROM m.start_at)::int || '-' ||
       UPPER(regexp_replace(COALESCE(m.tenant_code, 'GRN'), '[^A-Za-z0-9]', '', 'g')) || '-' ||
       LPAD((COALESCE(b.current_value, 0) + m.row_number)::text, 6, '0'),
       CASE m.trip_status
         WHEN 'pending' THEN 'awaiting_driver_acceptance'
         WHEN 'in_progress' THEN 'in_progress'
         WHEN 'return_due' THEN 'delayed'
         WHEN 'return_inspection' THEN 'awaiting_arrival_inspection'
         WHEN 'closure_review' THEN 'awaiting_reconciliation'
         WHEN 'closed' THEN 'closed'
         ELSE 'draft'
       END,
       1,
       m.start_at,
       m.end_at,
       m.purpose,
       COALESCE(m.special_authority_approved, false),
       m.special_authority_reason,
       m.created_at,
       1,
       jsonb_build_object(
         'requestReference', m.reference,
         'authorisedKilometres', m.total_authorised_kilometres,
         'migrated', true
       ),
       m.created_at,
       now()
FROM missing m
LEFT JOIN base b
  ON b.tenant_id = m.tenant_id
 AND b.sequence_year = EXTRACT(YEAR FROM m.start_at)::int
ON CONFLICT DO NOTHING;

INSERT INTO trip_authority_passengers (
  authority_id,
  employee_id,
  full_name,
  employee_number,
  contact_number,
  passenger_type,
  reason_for_travel,
  added_by_user_id,
  created_at
)
SELECT ta.id,
       rp.employee_id,
       COALESCE(NULLIF(trim(concat_ws(' ', e.first_name, e.last_name)), ''), rp.external_name, 'External passenger'),
       e.employee_number,
       e.phone,
       CASE WHEN rp.employee_id IS NULL THEN 'external_passenger' ELSE 'government_employee' END,
       ta.purpose,
       'migration',
       rp.created_at
FROM trip_authorities ta
JOIN request_passengers rp ON rp.request_id = ta.request_id AND rp.status = 'confirmed'
LEFT JOIN employees e ON e.id = rp.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM trip_authority_passengers tap
  WHERE tap.authority_id = ta.id
    AND (
      (tap.employee_id IS NOT NULL AND tap.employee_id = rp.employee_id)
      OR (tap.employee_id IS NULL AND tap.full_name = COALESCE(rp.external_name, 'External passenger'))
    )
);

INSERT INTO trip_authorised_drivers (
  authority_id,
  employee_id,
  driver_type,
  employee_number,
  licence_number_masked,
  licence_class,
  licence_expiry,
  reason,
  authorised_by_user_id,
  authorised_at
)
SELECT ta.id,
       va.driver_employee_id,
       'primary',
       e.employee_number,
       CASE
         WHEN dl.licence_number IS NULL THEN NULL
         WHEN length(dl.licence_number) <= 4 THEN repeat('*', length(dl.licence_number))
         ELSE repeat('*', length(dl.licence_number) - 4) || right(dl.licence_number, 4)
       END,
       dl.licence_class,
       dl.expiry_date::timestamptz,
       'Backfilled from the confirmed vehicle allocation',
       'migration',
       ta.created_at
FROM trip_authorities ta
JOIN vehicle_allocations va ON va.id = ta.allocation_id
JOIN employees e ON e.id = va.driver_employee_id
LEFT JOIN driver_profiles dp ON dp.employee_id = e.id
LEFT JOIN LATERAL (
  SELECT licence_number, licence_class, expiry_date
  FROM driver_licences
  WHERE driver_profile_id = dp.id
  ORDER BY expiry_date DESC
  LIMIT 1
) dl ON true
WHERE va.driver_employee_id IS NOT NULL
ON CONFLICT (authority_id, employee_id) DO NOTHING;

INSERT INTO trip_authority_versions (
  authority_id,
  version,
  status,
  snapshot,
  reason,
  created_by_user_id,
  created_at
)
SELECT ta.id,
       1,
       ta.status,
       to_jsonb(ta),
       'Legacy trip migrated to canonical Trip Authority',
       'migration',
       ta.created_at
FROM trip_authorities ta
ON CONFLICT (authority_id, version) DO NOTHING;

INSERT INTO trip_authority_sequences (tenant_id, sequence_year, current_value)
SELECT tenant_id,
       EXTRACT(YEAR FROM COALESCE(valid_from, created_at))::int,
       COUNT(*)::int
FROM trip_authorities
WHERE tenant_id IS NOT NULL
GROUP BY tenant_id, EXTRACT(YEAR FROM COALESCE(valid_from, created_at))
ON CONFLICT (tenant_id, sequence_year)
DO UPDATE SET current_value = GREATEST(trip_authority_sequences.current_value, EXCLUDED.current_value),
              updated_at = now();
