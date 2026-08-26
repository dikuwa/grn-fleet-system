import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { transportRequests } from './requests';

/**
 * Workflow definitions (versioned per tenant and trip scope).
 *
 * Historical versions remain available for existing workflow instances, but a
 * tenant may only have one active definition for an exact routing scope. The
 * partial unique index mirrors migration 0090 and closes the race where two
 * administrators could publish duplicate active routes concurrently.
 */
export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tripScope: text('trip_scope').notNull(), // regional, national
    regionId: uuid('region_id'),
    officeId: uuid('office_id'),
    departmentId: uuid('department_id'),
    // Null routing conditions are wildcards, preserving legacy definitions.
    requestOrigin: text('request_origin'), // internal, external, programme
    financialImpact: text('financial_impact'), // none, within_budget, additional_funding
    tripCategory: text('trip_category'),
    version: integer('version').notNull().default(1),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_definitions_one_active_per_route')
      .on(
        table.tenantId,
        table.tripScope,
        sql`COALESCE(${table.regionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${table.officeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${table.departmentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${table.requestOrigin}, '__any__')`,
        sql`COALESCE(${table.financialImpact}, '__any__')`,
        sql`COALESCE(${table.tripCategory}, '__any__')`,
      )
      .where(sql`${table.isActive} = true`),
  ],
);

/**
 * Workflow steps (ordered actions in a workflow)
 */
export const workflowSteps = pgTable('workflow_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  definitionId: uuid('definition_id')
    .notNull()
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  stepOrder: integer('step_order').notNull(),
  actionType: text('action_type').notNull(), // governed action type; see workflow-builder.ts
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
 * A request may accumulate historical completed/cancelled/overridden instances,
 * but there can be only one active instance at a time. Migration 0089 repairs
 * legacy duplicates and enforces the same invariant in PostgreSQL so concurrent
 * submissions cannot create parallel approval chains.
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
    // Per-request override for conflict-of-interest reassignment. Never write a
    // request-specific alternate into workflow_steps because those rows are
    // shared by every workflow instance using the definition.
    currentAssignedUserId: text('current_assigned_user_id'),
    currentAssignmentMeta: jsonb('current_assignment_meta')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Frozen request criteria used to select this workflow definition. */
    routingContext: jsonb('routing_context')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_instances_one_active_per_request')
      .on(table.requestId)
      .where(sql`${table.status} = 'active'`),
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
