# Database Design

## Conventions

- UUID primary keys
- `tenant_id` on all tenant data
- snake_case columns
- UTC timestamps
- integer `version` for optimistic concurrency
- audit references by immutable ID
- enums represented by PostgreSQL enums or constrained text according to migration flexibility

## Identity and tenancy

### `users`
Better Auth user record plus display status and first-login-password-change flag.

### `tenants`
Name, code, type, status, timezone, locale and platform metadata.

### `tenant_branding`
Logos, colours, contact/address, document footer and sender identity.

### `tenant_memberships`
User-to-tenant membership and status.

### `roles`, `permissions`, `role_permissions`
Capability model.

### `role_assignments`
Membership role, office scope, start/end, acting flag, delegated-by and reason.

## Organisation and people

### `offices`
Hierarchical office tree: head office, constituency, settlement or custom unit.

### `departments`
Tenant departments/directorates.

### `employees`
Employee number, names, title, department, office, employment status and contact. No login required.

### `employee_documents`
Private ID/authorisation documents.

### `driver_profiles`
Employee link, driver status and internal authorisation.

### `driver_licences`
Licence number/class, issue/expiry, allowed categories, document and verification status. Preserve history.

## Fleet

### `vehicle_categories`
Sedan, bakkie, SUV, bus and configured attributes.

### `vehicles`
GRN, registration, make/model, colour, body, fuel, transmission, office, current odometer and status.

### `vehicle_documents`
Licence disc, roadworthy, insurance and other expiries.

### `vehicle_status_events`
Available, provisional, allocated, issued, maintenance, out-of-service, written-off.

### `vehicle_defects`
Description, severity, reported stage, photos, blocking status and resolution.

### `maintenance_events`
Service date/odometer, cost, notes, documents and next due values.

### `vehicle_odometer_events`
Immutable odometer evidence from inspection, fuel, maintenance or manual correction.

## Requests and route

### `transport_requests`
Reference, revision, scope, status, requester, dates, purpose, special-authority flags, version and workflow instance.

### `request_revisions`
Snapshot of changed business fields and reason.

### `request_activities`
Activity, venue, start/end and estimated kilometres.

### `request_passengers`
Employee or approved external passenger link and status.

### `request_drivers`
Nominated/assigned/additional driver and order.

### `request_routes`
Origin/destination place IDs, coordinates, mapped distance/duration/polyline, additional km, total km, verification and override reason.

### `request_attachments`
Private supporting files.

## Workflow

### `workflow_definitions`
Tenant, trip scope, version, active date and configuration.

### `workflow_steps`
Order, action type, required permission, reminders, override policy and separation rules.

### `workflow_instances`
Request link, definition version, current step and state.

### `workflow_actions`
Approve, reject, return, release, authorise, acknowledge, override; actor, role assignment, comment, timestamp and signature reference.

### `emergency_overrides`
Authorising actor, reason, evidence, bypassed steps and review status.

## Allocation and trip

### `vehicle_allocations`
Request, vehicle, period, state, recommendation score, override reason and allocation actor.

Use a database exclusion constraint or transaction/advisory lock to prevent overlapping active allocations per vehicle.

### `trip_authorities`
Prefilled authority record, special authority, release/authorisation references and document version.

### `trip_issues`
Physical handover time, odometer, keys, fuel card, actor and driver acknowledgment.

### `trips`
Operational trip record linked to request/allocation; issued, started, returned and closed timestamps.

## Inspections

### `inspection_templates`, `inspection_template_items`
Versioned tenant checklist.

### `vehicle_inspections`
Departure or return; vehicle, trip, inspector, driver, odometer, fuel, status and signatures.

### `inspection_item_results`
Pass/fail/not-applicable, comment and defect link.

### `inspection_photos`
Private photo, item/stage and capture metadata.

## Logs and fuel

### `trip_log_entries`
Client sync ID, date, driver, odometer out/in, time out/in, from/to, distance, remarks, submission status and version.

### `fuel_transactions`
Date/time, station, type, litres, amount, odometer, reference, payment method, anomaly state and verification.

### `fuel_receipts`
Private file and extraction/manual verification metadata.

### `reimbursements`
Personal-payment amount, claimant, state and supporting record; payment processing remains out of scope.

## Closure

### `trip_closures`
Authorised vs actual kilometres, variance, fuel summary, missing-item flags, close actor and decision.

## Documents and sharing

### `generated_documents`
Entity, type, version, template version, snapshot JSON, file key, hash, status and redaction profile.

### `share_links`
Document/entity, token hash, expiry, revocation, max views, redaction profile, created by and last access.

### `share_access_events`
IP-derived risk metadata, user agent, result and timestamp; avoid excessive personal tracking.

## Notifications

### `notifications`
Recipient, type, entity, title/body, action URL, read state and priority.

### `notification_deliveries`
Channel, provider ID, attempt, status and error summary.

### `notification_preferences`
Tenant/user preferences and quiet hours.

## Imports

### `import_batches`
Source file, type, mapping, status, counts and actor.

### `import_rows`
Raw row JSON, normalized data, validation errors, duplicate match and commit result.

## Audit

### `audit_events`
Tenant chain sequence, event type, actor, role assignment, entity, canonical payload, previous hash, event hash, request ID and timestamp.

Database role should prevent application updates/deletes to this table.

## Critical indexes

- `(tenant_id, status, created_at desc)` requests
- `(tenant_id, requester_employee_id, created_at desc)`
- `(tenant_id, current_step, status)` workflow inbox
- `(tenant_id, vehicle_id, start_at, end_at)` allocations
- `(tenant_id, vehicle_status)` vehicles
- `(tenant_id, expiry_date)` licences/documents
- `(tenant_id, trip_id, log_date)` logs
- `(tenant_id, vehicle_id, transaction_at)` fuel
- `(tenant_id, event_at desc)` audit

## RLS

Tenant tables require a database session variable such as `app.tenant_id`. Platform operations use a separate controlled database role. Tests must prove no tenant-owned table is readable without tenant context.
