--> Additional performance indexes for frequently queried tables

-- Notifications: per-user lookup, type filtering, date ordering, read/unread counts
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON notifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);

-- Notification deliveries: notification lookup, channel filtering, status
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification_id ON notification_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel ON notification_deliveries(channel);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(status);

-- Audit events: tenant isolation, event type filtering, entity lookups, date range
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_id ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity_type ON audit_events(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity_id ON audit_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_type ON audit_events(tenant_id, event_type);

-- Generated documents: tenant, type, status, expiry lookups
CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant_id ON generated_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_generated_documents_document_type ON generated_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_generated_documents_status ON generated_documents(status);
CREATE INDEX IF NOT EXISTS idx_generated_documents_expires_at ON generated_documents(expires_at);

-- Share links: document lookup, status filtering, expiry checks
CREATE INDEX IF NOT EXISTS idx_share_links_document_id ON share_links(document_id);
CREATE INDEX IF NOT EXISTS idx_share_links_status ON share_links(status);
CREATE INDEX IF NOT EXISTS idx_share_links_expires_at ON share_links(expires_at);

-- Driver profiles: employee lookup, status, licence number searches
CREATE INDEX IF NOT EXISTS idx_driver_profiles_employee_id ON driver_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_status ON driver_profiles(status);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_licence_number ON driver_profiles(licence_number);

-- Driver licences: driver profile lookup, expiry queries
CREATE INDEX IF NOT EXISTS idx_driver_licences_profile_id ON driver_licences(driver_profile_id);
CREATE INDEX IF NOT EXISTS idx_driver_licences_expiry_date ON driver_licences(expiry_date);

-- Workflow instances: request tracking, current step, status filtering
CREATE INDEX IF NOT EXISTS idx_workflow_instances_request_id ON workflow_instances(request_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_current_step ON workflow_instances(current_step_order);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_definition_id ON workflow_instances(definition_id);

-- Workflow actions: instance tracking, chronological lookups
CREATE INDEX IF NOT EXISTS idx_workflow_actions_instance_id ON workflow_actions(instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_actions_step_id ON workflow_actions(step_id);
CREATE INDEX IF NOT EXISTS idx_workflow_actions_created_at ON workflow_actions(created_at);

-- Import batches: tenant isolation, status, type
CREATE INDEX IF NOT EXISTS idx_import_batches_tenant_id ON import_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
CREATE INDEX IF NOT EXISTS idx_import_batches_import_type ON import_batches(import_type);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON import_batches(created_at);

-- Import rows: batch lookup, status, validation
CREATE INDEX IF NOT EXISTS idx_import_rows_batch_id ON import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_status ON import_rows(status);

-- Trip issues: trip lookup
CREATE INDEX IF NOT EXISTS idx_trip_issues_trip_id ON trip_issues(trip_id);

-- Vehicle status events: vehicle, chronological lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_status_events_vehicle_id ON vehicle_status_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_status_events_created_at ON vehicle_status_events(created_at);

-- Inspection photos: inspection, checklist item lookups
CREATE INDEX IF NOT EXISTS idx_inspection_photos_inspection_id ON inspection_photos(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_photos_checklist_item_id ON inspection_photos(checklist_item_id);

-- Inspection checklist items: inspection lookup
CREATE INDEX IF NOT EXISTS idx_inspection_checklist_items_inspection_id ON inspection_checklist_items(inspection_id);

-- Employee documents: employee lookup, expiry
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry_date ON employee_documents(expiry_date);

-- Departments: tenant isolation
CREATE INDEX IF NOT EXISTS idx_departments_tenant_id ON departments(tenant_id);

-- Tenant memberships: user lookup, tenant lookup, role assignment
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_role ON tenant_memberships(role);
