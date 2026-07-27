import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { vehicles, vehicleDefects } from './fleet';
import { transportRequests } from './requests';
import { employees } from './people';

/**
 * Vehicle allocations
 */
export const vehicleAllocations = pgTable('vehicle_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id),
  driverEmployeeId: uuid('driver_employee_id')
    .references(() => employees.id),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  state: text('state').notNull().default('provisional'), // provisional, confirmed, cancelled, released
  recommendationScore: integer('recommendation_score'),
  overrideReason: text('override_reason'),
  allocatedByUserId: text('allocated_by_user_id').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Trip authorities (prefilled authority document data)
 */
export const tripAuthorities = pgTable('trip_authorities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id'),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  allocationId: uuid('allocation_id')
    .notNull()
    .references(() => vehicleAllocations.id),
  specialAuthorityGranted: boolean('special_authority_granted').notNull().default(false),
  authorityNumber: text('authority_number'),
  verificationTokenHash: text('verification_token_hash'),
  status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  purpose: text('purpose'),
  origin: text('origin'),
  destination: text('destination'),
  approvedRoute: text('approved_route'),
  specialConditions: text('special_conditions'),
  beginningOdometer: integer('beginning_odometer'),
  endingOdometer: integer('ending_odometer'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedByEmployeeId: uuid('accepted_by_employee_id').references(() => employees.id),
  acceptanceData: jsonb('acceptance_data').$type<Record<string, unknown>>(),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  authorisedAt: timestamp('authorised_at', { withTimezone: true }),
  authorisedByUserId: text('authorised_by_user_id'),
  authoriserSnapshot: jsonb('authoriser_snapshot').$type<Record<string, unknown>>(),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  releaseReference: text('release_reference'),
  authorisationReference: text('authorisation_reference'),
  documentVersion: integer('document_version').notNull().default(1),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_trip_authorities_tenant_number').on(table.tenantId, table.authorityNumber),
  uniqueIndex('uq_trip_authorities_trip').on(table.tripId),
  uniqueIndex('uq_trip_authorities_verification_hash').on(table.verificationTokenHash),
  index('idx_trip_authorities_tenant_status').on(table.tenantId, table.status),
]);

/** Tenant-scoped, atomically incremented Trip Authority numbering. */
export const tripAuthoritySequences = pgTable('trip_authority_sequences', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  sequenceYear: integer('sequence_year').notNull(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_trip_authority_sequence_tenant_year').on(table.tenantId, table.sequenceYear),
]);

/** Immutable authority versions retain the complete approved snapshot and document link. */
export const tripAuthorityVersions = pgTable('trip_authority_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorityId: uuid('authority_id')
    .notNull()
    .references(() => tripAuthorities.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  status: text('status').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  generatedDocumentId: uuid('generated_document_id'),
  reason: text('reason'),
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_trip_authority_versions_authority_version').on(table.authorityId, table.version),
]);

/** Approved passenger manifest copied from the request and amended with traceability. */
export const tripAuthorityPassengers = pgTable('trip_authority_passengers', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorityId: uuid('authority_id')
    .notNull()
    .references(() => tripAuthorities.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').references(() => employees.id),
  fullName: text('full_name').notNull(),
  employeeNumber: text('employee_number'),
  officeOrDepartment: text('office_or_department'),
  contactNumber: text('contact_number'),
  passengerType: text('passenger_type').notNull().default('government_employee'),
  boardingPoint: text('boarding_point'),
  destination: text('destination'),
  reasonForTravel: text('reason_for_travel'),
  indemnityRequired: boolean('indemnity_required').notNull().default(false),
  indemnityConfirmed: boolean('indemnity_confirmed').notNull().default(false),
  indemnityDocumentKey: text('indemnity_document_key'),
  approvalStatus: text('approval_status').notNull().default('approved'),
  addedByUserId: text('added_by_user_id').notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  removalReason: text('removal_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('idx_trip_authority_passengers_authority').on(table.authorityId)]);

/** Primary and additional authorised drivers, including segment handovers. */
export const tripAuthorisedDrivers = pgTable('trip_authorised_drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorityId: uuid('authority_id')
    .notNull()
    .references(() => tripAuthorities.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  driverType: text('driver_type').notNull().default('additional'),
  employeeNumber: text('employee_number'),
  licenceNumberMasked: text('licence_number_masked'),
  licenceClass: text('licence_class'),
  licenceExpiry: timestamp('licence_expiry', { withTimezone: true }),
  reason: text('reason'),
  authorisedByUserId: text('authorised_by_user_id'),
  authorisedAt: timestamp('authorised_at', { withTimezone: true }),
  takeoverOdometer: integer('takeover_odometer'),
  handoverOdometer: integer('handover_odometer'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_trip_authorised_drivers_authority_employee').on(table.authorityId, table.employeeId),
]);

/**
 * Physical vehicle issue records
 */
export const tripIssues = pgTable('trip_issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id'),
  allocationId: uuid('allocation_id')
    .notNull()
    .references(() => vehicleAllocations.id),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  issueOdometer: integer('issue_odometer'),
  keysIssued: boolean('keys_issued').notNull().default(true),
  fuelCardIssued: boolean('fuel_card_issued').notNull().default(false),
  issuedByUserId: text('issued_by_user_id').notNull(),
  acknowledgedByDriverId: uuid('acknowledged_by_driver_id'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Operational trips
 */
export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id),
  allocationId: uuid('allocation_id')
    .notNull()
    .references(() => vehicleAllocations.id),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id),
  status: text('status').notNull().default('pending'), // pending, in_progress, return_due, return_inspection, closure_review, closed
  driverAcknowledgedAt: timestamp('driver_acknowledged_at', { withTimezone: true }),
  driverAcknowledgedByEmployeeId: uuid('driver_acknowledged_by_employee_id').references(() => employees.id),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Touch-friendly chronological driver progress timeline. */
export const tripProgressEntries = pgTable('trip_progress_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  clientSyncId: text('client_sync_id'),
  entryType: text('entry_type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  location: text('location'),
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  odometerReading: integer('odometer_reading'),
  note: text('note'),
  routeDeviationReason: text('route_deviation_reason'),
  priorApprovalObtained: boolean('prior_approval_obtained'),
  attachmentKey: text('attachment_key'),
  createdByUserId: text('created_by_user_id').notNull(),
  offlineCreatedAt: timestamp('offline_created_at', { withTimezone: true }),
  serverReceivedAt: timestamp('server_received_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_trip_progress_tenant_sync').on(table.tenantId, table.clientSyncId),
  index('idx_trip_progress_trip_occurred').on(table.tripId, table.occurredAt),
]);

export const tripExpenses = pgTable('trip_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  clientSyncId: text('client_sync_id'),
  category: text('category').notNull(),
  supplier: text('supplier'),
  transactionAt: timestamp('transaction_at', { withTimezone: true }).notNull(),
  referenceNumber: text('reference_number'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('NAD'),
  odometerReading: integer('odometer_reading'),
  receiptKey: text('receipt_key'),
  verificationStatus: text('verification_status').notNull().default('awaiting_verification'),
  notes: text('notes'),
  enteredByUserId: text('entered_by_user_id').notNull(),
  verifiedByUserId: text('verified_by_user_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_trip_expenses_tenant_sync').on(table.tenantId, table.clientSyncId),
  index('idx_trip_expenses_trip').on(table.tripId),
]);

export const tripIncidents = pgTable('trip_incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  clientSyncId: text('client_sync_id'),
  incidentType: text('incident_type').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  location: text('location'),
  odometerReading: integer('odometer_reading'),
  description: text('description').notNull(),
  injuries: boolean('injuries').notNull().default(false),
  vehicleDamage: boolean('vehicle_damage').notNull().default(false),
  thirdPartyInvolvement: boolean('third_party_involvement').notNull().default(false),
  policeReference: text('police_reference'),
  emergencyServicesContacted: boolean('emergency_services_contacted').notNull().default(false),
  safeToContinue: boolean('safe_to_continue').notNull().default(true),
  actionTaken: text('action_taken'),
  attachmentKeys: jsonb('attachment_keys').$type<string[]>().default([]),
  administratorResponse: text('administrator_response'),
  status: text('status').notNull().default('reported'),
  reportedByUserId: text('reported_by_user_id').notNull(),
  offlineCreatedAt: timestamp('offline_created_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_trip_incidents_tenant_sync').on(table.tenantId, table.clientSyncId),
  index('idx_trip_incidents_trip_status').on(table.tripId, table.status),
]);

export const tripAmendments = pgTable('trip_amendments', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorityId: uuid('authority_id')
    .notNull()
    .references(() => tripAuthorities.id, { onDelete: 'cascade' }),
  amendmentType: text('amendment_type').notNull(),
  originalValue: jsonb('original_value').$type<Record<string, unknown>>(),
  newValue: jsonb('new_value').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'),
  requestedByUserId: text('requested_by_user_id').notNull(),
  approvedByUserId: text('approved_by_user_id'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('idx_trip_amendments_authority').on(table.authorityId)]);

/**
 * Inspection templates (versioned per tenant)
 */
export const inspectionTemplates = pgTable('inspection_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(), // departure, return
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Inspection template items
 */
export const inspectionTemplateItems = pgTable('inspection_template_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => inspectionTemplates.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  category: text('category').notNull(), // exterior, interior, tyres, lights, documents, safety
  label: text('label').notNull(),
  requiresPhoto: boolean('requires_photo').notNull().default(false),
  isCritical: boolean('is_critical').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vehicle inspections
 */
export const vehicleInspections = pgTable('vehicle_inspections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id),
  tripId: uuid('trip_id').references(() => trips.id),
  templateId: uuid('template_id')
    .notNull()
    .references(() => inspectionTemplates.id),
  templateVersion: integer('template_version').notNull(),
  type: text('type').notNull(), // departure, return
  odometerReading: integer('odometer_reading'),
  fuelLevel: text('fuel_level'), // empty, quarter, half, three_quarters, full
  inspectorUserId: text('inspector_user_id').notNull(),
  inspectorEmployeeId: uuid('inspector_employee_id'),
  driverEmployeeId: uuid('driver_employee_id')
    .references(() => employees.id),
  status: text('status').notNull().default('in_progress'), // in_progress, completed, failed
  overallPass: boolean('overall_pass'),
  signatureInspector: text('signature_inspector'),
  signatureDriver: text('signature_driver'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Inspection item results
 */
export const inspectionItemResults = pgTable('inspection_item_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id')
    .notNull()
    .references(() => vehicleInspections.id, { onDelete: 'cascade' }),
  templateItemId: uuid('template_item_id')
    .notNull()
    .references(() => inspectionTemplateItems.id),
  result: text('result').notNull(), // pass, fail, not_applicable
  comment: text('comment'),
  defectId: uuid('defect_id').references(() => vehicleDefects.id),
});


/**
 * Inspection photos
 */
export const inspectionPhotos = pgTable('inspection_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id')
    .notNull()
    .references(() => vehicleInspections.id, { onDelete: 'cascade' }),
  inspectionItemResultId: uuid('inspection_item_result_id'),
  fileKey: text('file_key').notNull(),
  caption: text('caption'),
  stage: text('stage'), // departure, return
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Trip log entries (daily driver logs)
 */
export const tripLogEntries = pgTable('trip_log_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  clientSyncId: text('client_sync_id'),
  driverEmployeeId: uuid('driver_employee_id')
    .notNull()
    .references(() => employees.id),
  logDate: timestamp('log_date', { withTimezone: true }).notNull(),
  odometerOut: integer('odometer_out'),
  odometerIn: integer('odometer_in'),
  departureTime: timestamp('departure_time', { withTimezone: true }),
  arrivalTime: timestamp('arrival_time', { withTimezone: true }),
  origin: text('origin'),
  destination: text('destination'),
  distanceKm: integer('distance_km'),
  remarks: text('remarks'),
  isSynced: boolean('is_synced').notNull().default(false),
  syncState: text('sync_state').notNull().default('pending'), // pending, synced, conflict, failed
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fuel transactions
 */
export const fuelTransactions = pgTable('fuel_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .references(() => trips.id, { onDelete: 'cascade' }),
  clientSyncId: text('client_sync_id'),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id),
  transactionAt: timestamp('transaction_at', { withTimezone: true }).notNull(),
  stationName: text('station_name'),
  fuelType: text('fuel_type').notNull(),
  litres: numeric('litres', { precision: 10, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  odometerReading: integer('odometer_reading'),
  referenceNumber: text('reference_number'),
  paymentMethod: text('payment_method').notNull(), // fuel_card, cash, personal_reimbursement
  fillType: text('fill_type').notNull().default('full'), // full, partial
  anomalyState: text('anomaly_state').default('none'), // none, flagged, verified, rejected
  anomalyNotes: text('anomaly_notes'),
  isVerified: boolean('is_verified').notNull().default(false),
  verifiedByUserId: text('verified_by_user_id'),
  recordedByUserId: text('recorded_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fuel receipts (uploaded images/documents)
 */
export const fuelReceipts = pgTable('fuel_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => fuelTransactions.id, { onDelete: 'cascade' }),
  fileKey: text('file_key').notNull(),
  originalFileName: text('original_file_name'),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size'),
  checksum: text('checksum'),
  ocrStatus: text('ocr_status').notNull().default('awaiting_ocr'),
  rawOcrResponse: jsonb('raw_ocr_response').$type<Record<string, unknown>>(),
  extractionData: jsonb('extraction_data').$type<Record<string, unknown>>(),
  fieldConfidence: jsonb('field_confidence').$type<Record<string, number>>(),
  extractionConfidence: numeric('extraction_confidence', { precision: 4, scale: 3 }),
  isVerified: boolean('is_verified').notNull().default(false),
  verifiedByUserId: text('verified_by_user_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_fuel_receipts_tenant_checksum').on(table.tenantId, table.checksum),
  index('idx_fuel_receipts_ocr_status').on(table.ocrStatus),
]);

/** Field-level OCR correction history; corrections never overwrite the extraction audit. */
export const receiptFieldCorrections = pgTable('receipt_field_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id')
    .notNull()
    .references(() => fuelReceipts.id, { onDelete: 'cascade' }),
  fieldName: text('field_name').notNull(),
  extractedValue: text('extracted_value'),
  correctedValue: text('corrected_value').notNull(),
  correctedByUserId: text('corrected_by_user_id').notNull(),
  correctedAt: timestamp('corrected_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reimbursements (personal payments needing repayment)
 */
export const reimbursements = pgTable('reimbursements', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id')
    .notNull()
    .unique()
    .references(() => fuelTransactions.id, { onDelete: 'cascade' }),
  claimantEmployeeId: uuid('claimant_employee_id')
    .notNull()
    .references(() => employees.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  state: text('state').notNull().default('pending'), // pending, approved, paid, rejected
  approvedByUserId: text('approved_by_user_id'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Trip closures
 */
export const tripClosures = pgTable('trip_closures', {
  id: uuid('id').primaryKey().defaultRandom(),
  tripId: uuid('trip_id')
    .notNull()
    .unique()
    .references(() => trips.id, { onDelete: 'cascade' }),
  authorisedKilometres: integer('authorised_kilometres'),
  actualKilometres: integer('actual_kilometres'),
  kilometreVariance: integer('kilometre_variance'),
  totalFuelLitres: numeric('total_fuel_litres', { precision: 10, scale: 2 }),
  totalFuelCost: numeric('total_fuel_cost', { precision: 12, scale: 2 }),
  missingItemFlags: jsonb('missing_item_flags').$type<string[]>(),
  reviewNotes: text('review_notes'),
  closedByUserId: text('closed_by_user_id').notNull(),
  decision: text('decision').notNull(), // closed, requires_correction, follow_up
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
