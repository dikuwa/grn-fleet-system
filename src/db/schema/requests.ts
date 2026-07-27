import { pgTable, uuid, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { employees, departments, offices } from './people';

/**
 * Transport requests
 */
export const transportRequests = pgTable('transport_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull(),
  clientSubmissionId: text('client_submission_id'),
  revision: integer('revision').notNull().default(1),
  scope: text('scope').notNull(), // regional, national
  status: text('status').notNull().default('draft'),
  requesterEmployeeId: uuid('requester_employee_id')
    .notNull()
    .references(() => employees.id),
  requesterUserId: text('requester_user_id'),
  enteredByUserId: text('entered_by_user_id'),
  requestSource: text('request_source').notNull().default('logged_in_self_service'),
  requestChannel: text('request_channel').notNull().default('dashboard'),
  submissionMethod: text('submission_method').notNull().default('logged_in'),
  verificationMethod: text('verification_method'),
  assistedReason: text('assisted_reason'),
  confirmationMethod: text('confirmation_method'),
  employeeConfirmationStatus: text('employee_confirmation_status'),
  publicTrackingTokenHash: text('public_tracking_token_hash'),
  preferredDriverEmployeeId: uuid('preferred_driver_employee_id').references(() => employees.id),
  assignedDriverEmployeeId: uuid('assigned_driver_employee_id').references(() => employees.id),
  driverPreference: text('driver_preference').notNull().default('no_preference'),
  requestingOfficeSnapshot: text('requesting_office_snapshot'),
  approvalOfficeId: uuid('approval_office_id').references(() => offices.id),
  travellerEmployeeId: uuid('traveller_employee_id').references(() => employees.id),
  urgency: text('urgency').notNull().default('normal'),
  overnight: boolean('overnight').notNull().default(false),
  specialRequirements: text('special_requirements'),
  vehicleRequirements: jsonb('vehicle_requirements').$type<Record<string, unknown>>().default({}),
  departmentId: uuid('department_id').references(() => departments.id),
  officeId: uuid('office_id').references(() => offices.id),
  regionId: uuid('region_id'),
  department: text('department'),
  purpose: text('purpose'),
  specialAuthorityRequired: boolean('special_authority_required').notNull().default(false),
  specialAuthorityReason: text('special_authority_reason'),
  specialAuthorityApproved: boolean('special_authority_approved'),
  totalAuthorisedKilometres: integer('total_authorised_kilometres'),
  workflowInstanceId: uuid('workflow_instance_id'),
  version: integer('version').notNull().default(1),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Request revisions (for tracking changes)
 */
export const requestRevisions = pgTable('request_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  changedFields: jsonb('changed_fields').$type<Record<string, unknown>>(),
  reason: text('reason'),
  createdByUserId: text('created_by_user_id').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Request activities (programme of activities, linked to a request)
 */
export const requestActivities = pgTable('request_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  venue: text('venue'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  estimatedKilometres: integer('estimated_kilometres'),
});

/**
 * Request passengers
 */
export const requestPassengers = pgTable('request_passengers', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').references(() => employees.id),
  externalName: text('external_name'), // For non-employee passengers
  status: text('status').notNull().default('confirmed'), // proposed, confirmed, removed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Request drivers (nominated, assigned, additional)
 */
export const requestDrivers = pgTable('request_drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  driverType: text('driver_type').notNull(), // nominated, assigned, additional
  sortOrder: integer('sort_order').notNull().default(1),
  isConfirmed: boolean('is_confirmed').notNull().default(false),
  licenceValidated: boolean('licence_validated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Request routes (origin/destination with mapped distance)
 */
export const requestRoutes = pgTable('request_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  originPlaceId: text('origin_place_id'),
  originName: text('origin_name'),
  originCoordinates: jsonb('origin_coordinates'),
  destinationPlaceId: text('destination_place_id'),
  destinationName: text('destination_name'),
  destinationCoordinates: jsonb('destination_coordinates'),
  mappedDistanceKm: integer('mapped_distance_km'),
  mappedDurationMinutes: integer('mapped_duration_minutes'),
  routePolyline: text('route_polyline'),
  additionalKilometres: integer('additional_kilometres').notNull().default(0),
  additionalKmReason: text('additional_km_reason'),
  totalKilometres: integer('total_kilometres').notNull().default(0),
  calculationTimestamp: timestamp('calculation_timestamp', { withTimezone: true }),
  isVerified: boolean('is_verified').notNull().default(false),
  overrideReason: text('override_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Request attachments (supporting files)
 */
export const requestAttachments = pgTable('request_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  fileKey: text('file_key').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size'),
  uploadedByUserId: text('uploaded_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
