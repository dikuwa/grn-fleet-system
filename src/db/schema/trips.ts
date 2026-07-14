import { pgTable, uuid, text, timestamp, boolean, integer, numeric, jsonb } from 'drizzle-orm/pg-core';
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
  requestId: uuid('request_id')
    .notNull()
    .references(() => transportRequests.id, { onDelete: 'cascade' }),
  allocationId: uuid('allocation_id')
    .notNull()
    .references(() => vehicleAllocations.id),
  specialAuthorityGranted: boolean('special_authority_granted').notNull().default(false),
  releaseReference: text('release_reference'),
  authorisationReference: text('authorisation_reference'),
  documentVersion: integer('document_version').notNull().default(1),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
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
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => fuelTransactions.id, { onDelete: 'cascade' }),
  fileKey: text('file_key').notNull(),
  mimeType: text('mime_type').notNull(),
  extractionData: jsonb('extraction_data').$type<Record<string, unknown>>(),
  extractionConfidence: numeric('extraction_confidence', { precision: 4, scale: 3 }),
  isVerified: boolean('is_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
