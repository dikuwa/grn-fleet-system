import { pgTable, uuid, text, timestamp, boolean, integer, numeric, date } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { offices } from './people';

/**
 * Vehicle categories (sedan, bakkie, SUV, bus, etc.)
 */
export const vehicleCategories = pgTable('vehicle_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  passengerCapacity: integer('passenger_capacity').notNull().default(5),
  cargoCapacity: text('cargo_capacity'),
  suitableTerrain: text('suitable_terrain'), // tar, gravel, offroad
  fuelType: text('fuel_type'), // petrol, diesel, electric
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vehicles
 */
export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => vehicleCategories.id),
  officeId: uuid('office_id').references(() => offices.id),
  
  // SECTION A — Vehicle identity
  licenceNumber: text('licence_number').notNull(), // Physical plate number
  vehicleRegisterNumber: text('vehicle_register_number'), // NaTIS Register number
  vin: text('vin'),
  engineNumber: text('engine_number'),

  // SECTION B — Vehicle description
  make: text('make').notNull(),
  model: text('model').notNull(),
  seriesName: text('series_name'),
  manufactureYear: integer('manufacture_year'),
  vehicleCategory: text('vehicle_category'), // e.g. Light passenger motor vehicle
  vehicleDescription: text('vehicle_description'), // e.g. Sedan, Hatchback
  driveType: text('drive_type'), // e.g. Self-propelled
  colour: text('colour'),
  fuelType: text('fuel_type').notNull().default('petrol'),
  transmission: text('transmission').notNull().default('manual'),

  // SECTION C — Weight and capacity
  tareKg: integer('tare_kg'),
  grossVehicleMassKg: integer('gross_vehicle_mass_kg'),
  seatedCapacity: integer('seated_capacity'),
  standingCapacity: integer('standing_capacity'),

  // SECTION D — Registration and compliance
  registeringAuthority: text('registering_authority'),
  nationalVehicleClassification: text('national_vehicle_classification'),
  roadworthyTestDate: date('roadworthy_test_date'),
  licenceExpiryDate: date('licence_expiry_date'),

  // SECTION E — Fleet assignment
  status: text('status').notNull().default('available'), // available, provisional, allocated, issued, maintenance, out_of_service, written_off
  currentOdometer: integer('current_odometer').notNull().default(0),
  fuelCardNumber: text('fuel_card_number'),
  fuelCardPin: text('fuel_card_pin'),
  assignedRegionId: uuid('assigned_region_id'), // Regional council specific
  assignedOfficeId: uuid('assigned_office_id'), // References offices.id
  
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
});

/**
 * Vehicle documents (licence disc, roadworthy, insurance)
 */
export const vehicleDocuments = pgTable('vehicle_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  documentType: text('document_type').notNull(), // licence_disc, roadworthy, insurance, other
  documentName: text('document_name').notNull(),
  referenceNumber: text('reference_number'),
  issueDate: date('issue_date'),
  expiryDate: date('expiry_date'),
  fileKey: text('file_key'),
  isVerified: boolean('is_verified').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vehicle status events (audit trail of status changes)
 */
export const vehicleStatusEvents = pgTable('vehicle_status_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  previousStatus: text('previous_status'),
  newStatus: text('new_status').notNull(),
  reason: text('reason'),
  changedByUserId: text('changed_by_user_id').notNull(),
  referenceEntityType: text('reference_entity_type'), // trip, allocation, maintenance
  referenceEntityId: text('reference_entity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vehicle defects
 */
export const vehicleDefects = pgTable('vehicle_defects', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id'),
  inspectionId: uuid('inspection_id'),
  severity: text('severity').notNull().default('minor'), // informational, minor, major, critical
  description: text('description').notNull(),
  isBlocking: boolean('is_blocking').notNull().default(false),
  reportedByUserId: text('reported_by_user_id').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedByUserId: text('resolved_by_user_id'),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Maintenance events
 */
export const maintenanceEvents = pgTable('maintenance_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  serviceDate: date('service_date').notNull(),
  serviceOdometer: integer('service_odometer'),
  serviceType: text('service_type').notNull(), // scheduled, repair, inspection
  description: text('description').notNull(),
  cost: numeric('cost', { precision: 12, scale: 2 }),
  vendorName: text('vendor_name'),
  notes: text('notes'),
  nextServiceDate: date('next_service_date'),
  nextServiceOdometer: integer('next_service_odometer'),
  documentKeys: text('document_keys'), // Comma-separated or JSON array
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Immutable odometer events
 */
export const vehicleOdometerEvents = pgTable('vehicle_odometer_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  odometerValue: integer('odometer_value').notNull(),
  source: text('source').notNull(), // inspection, fuel, maintenance, manual_correction
  sourceEntityType: text('source_entity_type'), // inspection, fuel_transaction, maintenance
  sourceEntityId: uuid('source_entity_id'),
  recordedByUserId: text('recorded_by_user_id').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Regions (for vehicle assignment and reporting)
 */
export const regions = pgTable('regions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type VehicleDefect = typeof vehicleDefects.$inferSelect;
export type MaintenanceEvent = typeof maintenanceEvents.$inferSelect;
export type Region = typeof regions.$inferSelect;
