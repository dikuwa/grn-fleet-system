import { pgTable, uuid, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { employees } from './people';

/**
 * Transport requests
 */
export const transportRequests = pgTable('transport_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull(),
  revision: integer('revision').notNull().default(1),
  scope: text('scope').notNull(), // regional, national
  status: text('status').notNull().default('draft'),
  requesterEmployeeId: uuid('requester_employee_id')
    .notNull()
    .references(() => employees.id),
  requesterUserId: text('requester_user_id').notNull(),
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
