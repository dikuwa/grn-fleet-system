import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { employees, departments, offices } from './people';
import { externalParties } from './external-parties';
import { programmes } from './programmes';

/**
 * Transport requests.
 *
 * For external requests requesterEmployeeId remains the responsible internal
 * employee used by the existing approval-routing model. requesterType and
 * externalRequesterId identify the actual external requester. This preserves
 * current internal workflow semantics without putting external people into the
 * staff directory or making the core requester FK nullable across the app.
 */
export const transportRequests = pgTable(
  'transport_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    clientSubmissionId: text('client_submission_id'),
    revision: integer('revision').notNull().default(1),
    scope: text('scope').notNull(), // regional, national
    status: text('status').notNull().default('draft'),
    requesterType: text('requester_type').notNull().default('internal'), // internal, external
    /**
     * Immutable routing origin captured at submission. Programme is explicit
     * rather than inferred at runtime so later programme edits cannot change
     * the governed route selected for an existing request.
     */
    requestOrigin: text('request_origin').notNull().default('internal'), // internal, external, programme
    financialImpact: text('financial_impact').notNull().default('none'), // none, within_budget, additional_funding
    tripCategory: text('trip_category').notNull().default('general'),
    estimatedCost: numeric('estimated_cost', { precision: 12, scale: 2 }),
    currency: text('currency').notNull().default('NAD'),
    costCentre: text('cost_centre'),
    fundingSource: text('funding_source'),
    budgetReference: text('budget_reference'),
    requesterEmployeeId: uuid('requester_employee_id')
      .notNull()
      .references(() => employees.id),
    externalRequesterId: uuid('external_requester_id').references(() => externalParties.id),
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
    preferredDriverExternalPartyId: uuid('preferred_driver_external_party_id').references(
      () => externalParties.id,
    ),
    assignedDriverEmployeeId: uuid('assigned_driver_employee_id').references(() => employees.id),
    assignedDriverExternalPartyId: uuid('assigned_driver_external_party_id').references(
      () => externalParties.id,
    ),
    driverPreference: text('driver_preference').notNull().default('no_preference'),
    requestingOfficeSnapshot: text('requesting_office_snapshot'),
    approvalOfficeId: uuid('approval_office_id').references(() => offices.id),
    travellerEmployeeId: uuid('traveller_employee_id').references(() => employees.id),
    urgency: text('urgency').notNull().default('normal'),
    overnight: boolean('overnight').notNull().default(false),
    specialRequirements: text('special_requirements'),
    vehicleRequirements: jsonb('vehicle_requirements').$type<Record<string, unknown>>().default({}),
    /**
     * Optional number copied from a physical Trip Authority book by Transport Office.
     * It is reserved on the request before final authorisation, then becomes the
     * canonical trip_authorities.authority_number when the authority is provisioned.
     */
    physicalTripAuthorityNumber: text('physical_trip_authority_number'),
    physicalTripAuthorityNumberSetByUserId: text('physical_trip_authority_number_set_by_user_id'),
    physicalTripAuthorityNumberSetAt: timestamp('physical_trip_authority_number_set_at', {
      withTimezone: true,
    }),
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
    programmeId: uuid('programme_id').references(() => programmes.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_transport_requests_tenant_reference_v2')
      .on(table.tenantId, table.reference)
      .where(sql`${table.reference} ~ '^GRN/TR/[0-9]{4}/[0-9]{6}$'`),
    uniqueIndex('uq_transport_requests_tenant_submission')
      .on(table.tenantId, table.clientSubmissionId)
      .where(sql`${table.clientSubmissionId} IS NOT NULL`),
    uniqueIndex('uq_transport_requests_tenant_physical_authority_number')
      .on(table.tenantId, table.physicalTripAuthorityNumber)
      .where(sql`${table.physicalTripAuthorityNumber} IS NOT NULL`),
  ],
);

/** Request revisions (for tracking changes). */
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

/** Request activities (programme of activities, linked to a request). */
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

/** Request passengers. */
export const requestPassengers = pgTable('request_passengers', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').references(() => employees.id),
  externalName: text('external_name'),
  externalIdReference: text('external_id_reference'),
  externalOrganisation: text('external_organisation'),
  externalPhone: text('external_phone'),
  externalEmail: text('external_email'),
  travellerRole: text('traveller_role').notNull().default('passenger'),
  reasonForTravel: text('reason_for_travel'),
  status: text('status').notNull().default('confirmed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Internal request drivers. External nominations use externalRequestDrivers. */
export const requestDrivers = pgTable('request_drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  driverType: text('driver_type').notNull(),
  sortOrder: integer('sort_order').notNull().default(1),
  isConfirmed: boolean('is_confirmed').notNull().default(false),
  licenceValidated: boolean('licence_validated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * External driver nominations are isolated from employee request drivers so
 * existing staff selectors, RBAC and driver workflows cannot accidentally
 * treat an external person as an employee.
 */
export const externalRequestDrivers = pgTable(
  'external_request_drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => transportRequests.id, { onDelete: 'cascade' }),
    externalPartyId: uuid('external_party_id')
      .notNull()
      .references(() => externalParties.id),
    driverType: text('driver_type').notNull().default('nominated'),
    sortOrder: integer('sort_order').notNull().default(1),
    isConfirmed: boolean('is_confirmed').notNull().default(false),
    licenceValidated: boolean('licence_validated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_external_request_driver').on(table.requestId, table.externalPartyId),
    index('idx_external_request_driver_party').on(table.externalPartyId),
  ],
);

/** Request routes (origin/destination with mapped distance). */
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

/** Goods and equipment travelling under a request. */
export const requestGoodsEquipment = pgTable('request_goods_equipment', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: text('quantity'),
  purpose: text('purpose'),
  sortOrder: integer('sort_order').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Request attachments (supporting files). */
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
