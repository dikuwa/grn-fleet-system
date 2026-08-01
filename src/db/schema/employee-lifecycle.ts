import { pgTable, uuid, text, timestamp, boolean, date, jsonb, integer } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { employees, offices, departments } from './people';
import { regions } from './fleet';

export const employeeAssignments = pgTable('employee_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  officeId: uuid('office_id').references(() => offices.id),
  regionId: uuid('region_id'),
  directorate: text('directorate'),
  departmentId: uuid('department_id').references(() => departments.id),
  jobTitle: text('job_title'),
  position: text('position'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  supervisorEmployeeId: uuid('supervisor_employee_id').references(() => employees.id),
  reason: text('reason'),
  createdByUserId: text('created_by_user_id').notNull(),
  approvedByUserId: text('approved_by_user_id'),
  isCurrent: boolean('is_current').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const employeeAvailability = pgTable('employee_availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  status: text('status').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  reason: text('reason'),
  notes: text('notes'),
  supportingDocumentKey: text('supporting_document_key'),
  enteredByUserId: text('entered_by_user_id').notNull(),
  approvedByUserId: text('approved_by_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roleDelegations = pgTable('role_delegations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organisationalUnit: text('organisational_unit'),
  officeId: uuid('office_id').references(() => offices.id, { onDelete: 'set null' }),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  regionId: uuid('region_id').references(() => regions.id, { onDelete: 'set null' }),
  roleId: uuid('role_id').notNull(),
  substantiveHolderEmployeeId: uuid('substantive_holder_employee_id').references(() => employees.id),
  actingEmployeeId: uuid('acting_employee_id').notNull().references(() => employees.id),
  actingTitle: text('acting_title').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
  approvalAuthority: text('approval_authority'),
  canApprove: boolean('can_approve').notNull().default(false),
  canSign: boolean('can_sign').notNull().default(false),
  canAllocateVehicles: boolean('can_allocate_vehicles').notNull().default(false),
  canAssignDrivers: boolean('can_assign_drivers').notNull().default(false),
  canReconcileTrips: boolean('can_reconcile_trips').notNull().default(false),
  canDelegateFurther: boolean('can_delegate_further').notNull().default(false),
  appointmentMemoKey: text('appointment_memo_key'),
  createdByUserId: text('created_by_user_id').notNull(),
  authorisedByUserId: text('authorised_by_user_id'),
  status: text('status').notNull().default('scheduled'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedByUserId: text('revoked_by_user_id'),
  revocationReason: text('revocation_reason'),
  overrideReason: text('override_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const signatoryPositions = pgTable('signatory_positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  roleId: uuid('role_id').notNull(),
  organisationalUnit: text('organisational_unit'),
  fallbackRoleIds: jsonb('fallback_role_ids').$type<string[]>().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const employeeCorrectionRequests = pgTable('employee_correction_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  proposedChanges: jsonb('proposed_changes').$type<Record<string, string>>().notNull(),
  source: text('source').notNull().default('secure_request'),
  status: text('status').notNull().default('pending'),
  reviewedByUserId: text('reviewed_by_user_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewReason: text('review_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const secureRequestVerifications = pgTable('secure_request_verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').references(() => employees.id),
  identityHash: text('identity_hash').notNull(),
  otpHash: text('otp_hash').notNull(),
  channel: text('channel').notNull().default('email'),
  destinationMasked: text('destination_masked'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  requestIpHash: text('request_ip_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const secureRequestSessions = pgTable('secure_request_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id),
  verificationId: uuid('verification_id').notNull().references(() => secureRequestVerifications.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
