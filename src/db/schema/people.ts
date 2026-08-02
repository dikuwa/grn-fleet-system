import { pgTable, uuid, text, timestamp, boolean, date, integer, jsonb, doublePrecision, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Hierarchical offices (head office, constituency, settlement)
 */
export const offices = pgTable('offices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  type: text('type').notNull().default('constituency_office'), // head_office, constituency_office, settlement_office, directorate
  code: text('code'),
  address: text('address'),
  town: text('town'),
  phone: text('phone'),
  email: text('email'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: text('sort_order').default('0'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Departments/directorates
 */
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code'),
  type: text('type').notNull().default('department'), // directorate, department, unit
  parentId: uuid('parent_id'),
  headEmployeeId: uuid('head_employee_id'),
  isActive: boolean('is_active').notNull().default(true),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Explicit many-to-many mapping between organisation units and offices. */
export const departmentOffices = pgTable('department_offices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  officeId: uuid('office_id').notNull().references(() => offices.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('department_offices_tenant_department_office_uidx').on(table.tenantId, table.departmentId, table.officeId),
  index('department_offices_office_idx').on(table.tenantId, table.officeId),
]);

/** Transactional, tenant-scoped employee-number allocator. */
export const employeeNumberCounters = pgTable('employee_number_counters', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  nextValue: integer('next_value').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Employees (staff directory - separate from login accounts)
 */
export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  employeeNumber: text('employee_number').notNull(),
  title: text('title'),
  firstName: text('first_name').notNull(),
  middleName: text('middle_name'),
  lastName: text('last_name').notNull(),
  initials: text('initials'),
  preferredName: text('preferred_name'),
  nationalIdNumber: text('national_id_number'),
  passportNumber: text('passport_number'),
  dateOfBirth: date('date_of_birth'),
  gender: text('gender'),
  jobTitle: text('job_title'),
  substantivePosition: text('substantive_position'),
  grade: text('grade'),
  departmentId: uuid('department_id').references(() => departments.id),
  officeId: uuid('office_id').references(() => offices.id),
  regionId: uuid('region_id'),
  directorate: text('directorate'),
  supervisorEmployeeId: uuid('supervisor_employee_id'),
  email: text('email'),
  phone: text('phone'),
  alternativePhone: text('alternative_phone'),
  emergencyContact: jsonb('emergency_contact').$type<{ name?: string; relationship?: string; phone?: string }>(),
  employmentType: text('employment_type'),
  employmentStartDate: date('employment_start_date'),
  employmentEndDate: date('employment_end_date'),
  employmentStatus: text('employment_status').notNull().default('active'),
  availabilityStatus: text('availability_status').notNull().default('available'),
  isSignatory: boolean('is_signatory').notNull().default(false),
  isDriver: boolean('is_driver').notNull().default(false),
  profilePhotoUrl: text('profile_photo_url'),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedByUserId: text('archived_by_user_id'),
  userId: text('user_id'), // Linked Better Auth user ID (if they have login access)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Employee private documents (ID, authorisations)
 */
export const employeeDocuments = pgTable('employee_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id, { onDelete: 'cascade' }),
  documentType: text('document_type').notNull(),
  documentName: text('document_name').notNull(),
  fileKey: text('file_key').notNull(),
  mimeType: text('mime_type').notNull(),
  expiryDate: date('expiry_date'),
  isVerified: boolean('is_verified').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Driver profiles (extended employee info for drivers)
 */
export const driverProfiles = pgTable('driver_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id')
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: 'cascade' }),
  driverStatus: text('driver_status').notNull().default('authorised'), // authorised, suspended, expired
  availabilityStatus: text('availability_status').notNull().default('available'), // available, assigned, unavailable, leave
  unavailableUntil: timestamp('unavailable_until', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  verifiedByUserId: text('verified_by_user_id'),
  internalAuthorisationRef: text('internal_authorisation_ref'),
  classification: text('classification').notNull().default('official'),
  drivingRestrictions: text('driving_restrictions'),
  preferredVehicleTypes: text('preferred_vehicle_types'),
  suspensionReason: text('suspension_reason'),
  suspensionEndsAt: timestamp('suspension_ends_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Driver licence records (historical preservation)
 */
export const driverLicences = pgTable('driver_licences', {
  id: uuid('id').primaryKey().defaultRandom(),
  driverProfileId: uuid('driver_profile_id')
    .notNull()
    .references(() => driverProfiles.id, { onDelete: 'cascade' }),
  licenceNumber: text('licence_number').notNull(),
  licenceClass: text('licence_class').notNull(),
  issueDate: date('issue_date').notNull(),
  expiryDate: date('expiry_date').notNull(),
  holderName: text('holder_name'),
  dateOfBirth: date('date_of_birth'),
  gender: text('gender'),
  nationalIdNumber: text('national_id_number'),
  issuingAuthority: text('issuing_authority'),
  driverRestrictionCode: text('driver_restriction_code'),
  issueNumber: text('issue_number'),
  allowedVehicleCategories: text('allowed_vehicle_categories'),
  documentKey: text('document_key'),
  frontImageKey: text('front_image_key'),
  backImageKey: text('back_image_key'),
  sourcePdfKey: text('source_pdf_key'),
  rawOcrResult: jsonb('raw_ocr_result').$type<Record<string, unknown>>(),
  ocrConfidence: jsonb('ocr_confidence').$type<Record<string, number>>(),
  ocrProvider: text('ocr_provider'),
  entryMethod: text('entry_method').notNull().default('manual'),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  isVerified: boolean('is_verified').notNull().default(false),
  verificationStatus: text('verification_status').notNull().default('uploaded'),
  verifiedByUserId: text('verified_by_user_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const driverLicenceCodes = pgTable('driver_licence_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  licenceId: uuid('licence_id').notNull().references(() => driverLicences.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  firstIssueDate: date('first_issue_date'),
  vehicleRestriction: text('vehicle_restriction'),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
});

export const driverProfessionalAuthorisations = pgTable('driver_professional_authorisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  driverProfileId: uuid('driver_profile_id').notNull().references(() => driverProfiles.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  categoryType: text('category_type'),
  validFrom: date('valid_from'),
  expiryDate: date('expiry_date').notNull(),
  restrictions: text('restrictions'),
  isVerified: boolean('is_verified').notNull().default(false),
  verifiedByUserId: text('verified_by_user_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const driverLicenceCorrections = pgTable('driver_licence_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  licenceId: uuid('licence_id').notNull().references(() => driverLicences.id, { onDelete: 'cascade' }),
  fieldName: text('field_name').notNull(),
  originalValue: text('original_value'),
  correctedValue: text('corrected_value'),
  correctedByUserId: text('corrected_by_user_id'),
  source: text('source').notNull().default('review'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Office = typeof offices.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type DepartmentOffice = typeof departmentOffices.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type DriverLicence = typeof driverLicences.$inferSelect;
