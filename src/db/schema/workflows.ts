import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { transportRequests } from './requests';

/**
 * Workflow definitions (versioned per tenant and trip scope)
 */
export const workflowDefinitions = pgTable('workflow_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  tripScope: text('trip_scope').notNull(), // regional, national
  regionId: uuid('region_id'),
  officeId: uuid('office_id'),
  departmentId: uuid('department_id'),
  version: integer('version').notNull().default(1),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Workflow steps (ordered actions in a workflow)
 */
export const workflowSteps = pgTable('workflow_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  definitionId: uuid('definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  actionType: text('action_type').notNull(), // supervisor_approve, transport_review, release, authorise, acknowledge
  requiredPermission: text('required_permission'),
  assignedUserId: text('assigned_user_id'),
  label: text('label').notNull(),
  description: text('description'),
  requiresComment: boolean('requires_comment').notNull().default(false),
  reminderAfterHours: integer('reminder_after_hours').default(2),
  escalationAfterHours: integer('escalation_after_hours').default(4),
  allowsEmergencyOverride: boolean('allows_emergency_override').notNull().default(false),
  separationDutyRole: text('separation_duty_role'), // Role that cannot perform this step if they performed another
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Workflow instances (created per request submission).
 *
 * The current resolved assignment belongs to the instance, not the reusable
 * workflow definition. Acting/delegated/conflict reassignment for one request
 * must therefore never mutate workflow_steps and accidentally affect other
 * workflow instances using the same definition.
 */
export const workflowInstances = pgTable(
  'workflow_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => transportRequests.id, { onDelete: 'cascade' }),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => workflowDefinitions.id),
    definitionVersion: integer('definition_version').notNull(),
    currentStepOrder: integer('current_step_order').notNull().default(0),
    status: text('status').notNull().default('active'), // active, completed, cancelled, overridden
    currentAssignedUserId: text('current_assigned_user_id'),
    currentAssignedEmployeeId: uuid('current_assigned_employee_id'),
    currentRoleAssignmentId: uuid('current_role_assignment_id'),
    currentAssignmentIsActing: boolean('current_assignment_is_acting').notNull().default(false),
    currentAssignmentSource: text('current_assignment_source'),
    currentAssignmentMetadata: jsonb('current_assignment_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workflow_instances_current_assigned_user_idx')
      .on(table.currentAssignedUserId)
      .where(sql`${table.status} = 'active' AND ${table.currentAssignedUserId} IS NOT NULL`),
  ],
);

/**
 * Workflow actions (approve, reject, return, release, authorise, etc.)
 *
 * Migration 0011 already enforces one durable decision per workflow step at
 * the database level. Declare the same constraint here so Drizzle's schema is
 * an accurate model of the production database and concurrent action logic can
 * rely on the invariant explicitly.
 */
export const workflowActions = pgTable(
  'workflow_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    actionType: text('action_type').notNull(),
    result: text('result').notNull(), // approved, rejected, returned, released, authorised, acknowledged, overridden
    actorUserId: text('actor_user_id').notNull(),
    actorEmployeeId: uuid('actor_employee_id'),
    roleAssignmentId: uuid('role_assignment_id'),
    isActing: boolean('is_acting').notNull().default(false),
    comment: text('comment'),
    signatureRef: text('signature_ref'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_actions_instance_step_unique').on(table.instanceId, table.stepOrder),
  ],
);

/**
 * Emergency overrides
 */
export const emergencyOverrides = pgTable('emergency_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id')
    .notNull()
    .references(() => workflowInstances.id, { onDelete: 'cascade' }),
  authorisedByUserId: text('authorised_by_user_id').notNull(),
  authorisedByEmployeeId: uuid('authorised_by_employee_id'),
  reason: text('reason').notNull(),
  evidence: text('evidence'),
  bypassedSteps: jsonb('bypassed_steps').$type<number[]>().notNull(),
  requiresPostTripReview: boolean('requires_post_trip_review').notNull().default(true),
  reviewStatus: text('review_status').default('pending'), // pending, reviewed, closed
  reviewNotes: text('review_notes'),
  expiryDate: timestamp('expiry_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
