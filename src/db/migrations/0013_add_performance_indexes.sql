--> Add performance indexes for frequently queried columns

-- Trips: tenant isolation, status filtering, date range queries
CREATE INDEX IF NOT EXISTS idx_trips_tenant_id ON trips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips(created_at);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_id ON trips(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trips_request_id ON trips(request_id);

-- Vehicles: tenant isolation, status, licence plate lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_licence_number ON vehicles(licence_number);

-- Transport requests: tenant isolation, status filtering, requester lookups
CREATE INDEX IF NOT EXISTS idx_transport_requests_tenant_id ON transport_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_status ON transport_requests(status);
CREATE INDEX IF NOT EXISTS idx_transport_requests_requester_user_id ON transport_requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_transport_requests_created_at ON transport_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_transport_requests_reference ON transport_requests(reference);

-- Fuel transactions: vehicle lookups, date range, payment method
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_vehicle_id ON fuel_transactions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_transaction_at ON fuel_transactions(transaction_at);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_payment_method ON fuel_transactions(payment_method);

-- Vehicle allocations: request, vehicle, state lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_allocations_request_id ON vehicle_allocations(request_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_allocations_vehicle_id ON vehicle_allocations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_allocations_state ON vehicle_allocations(state);

-- Vehicle inspections: tenant, vehicle, trip, type lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_tenant_id ON vehicle_inspections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_vehicle_id ON vehicle_inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_trip_id ON vehicle_inspections(trip_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_type ON vehicle_inspections(type);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_status ON vehicle_inspections(status);

-- Maintenance events: vehicle lookups, service date, service type
CREATE INDEX IF NOT EXISTS idx_maintenance_events_vehicle_id ON maintenance_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_events_service_date ON maintenance_events(service_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_events_service_type ON maintenance_events(service_type);

-- Vehicle defects: vehicle, severity lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_defects_vehicle_id ON vehicle_defects(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_defects_severity ON vehicle_defects(severity);

-- Employees: tenant, email, employee number lookups
CREATE INDEX IF NOT EXISTS idx_employees_tenant_id ON employees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);

-- Offices: tenant lookups
CREATE INDEX IF NOT EXISTS idx_offices_tenant_id ON offices(tenant_id);

-- Vehicle odometer events: vehicle, date lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_events_vehicle_id ON vehicle_odometer_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_events_created_at ON vehicle_odometer_events(created_at);

-- Fuel receipts: transaction lookups
CREATE INDEX IF NOT EXISTS idx_fuel_receipts_transaction_id ON fuel_receipts(transaction_id);

-- Reimbursements: transaction, state lookups
CREATE INDEX IF NOT EXISTS idx_reimbursements_transaction_id ON reimbursements(transaction_id);
CREATE INDEX IF NOT EXISTS idx_reimbursements_state ON reimbursements(state);
