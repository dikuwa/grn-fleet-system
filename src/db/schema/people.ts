import { pgTable, uuid, text, timestamp, boolean, date } from 'drizzle-orm/pg-core';
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
  phone: text('phone'),
  email: text('email'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: text('sort_order').default('0'),
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
  headEmployeeId: uuid('head_employee_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  gender: text('gender'),
  jobTitle: text('job_title'),
  grade: text('grade'),
  departmentId: uuid('department_id').references(() => departments.id),
  officeId: uuid('office_id').references(() => offices.id),
  email: text('email'),
  phone: text('phone'),
  employmentStatus: text('employment_status').notNull().default('active'), // active, suspended, terminated
  isDriver: boolean('is_driver').notNull().default(false),
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
  internalAuthorisationRef: text('internal_authorisation_ref'),
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
  allowedVehicleCategories: text('allowed_vehicle_categories'),
  documentKey: text('document_key'),
  isVerified: boolean('is_verified').notNull().default(false),
  verificationStatus: text('verification_status').notNull().default('pending'), // pending, verified, expired, rejected
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Office = typeof offices.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type DriverLicence = typeof driverLicences.$inferSelect;
