import { pgTable, uuid, text, timestamp, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { employees, departments, offices } from './people';
import { regions } from './fleet';

/**
 * Programmes — reusable organisational activities / planned events.
 *
 * A Programme is NOT a transport request. It is a reusable planned activity
 * (regional outreach, inspection programme, training, district coordination,
 * community service, multi-day operational activity) that may later be linked
 * to one or more transport requests via `transport_requests.programme_id`.
 *
 * Lifecycle: draft → submitted → changes_requested → approved → published
 *            (published → archived | completed), rejected
 * Submitted Programmes go to the Tenant Administrator (or configured
 * Programme reviewer) — NOT through the transport request authorisation chain.
 */
export const programmes = pgTable(
  'programmes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    purpose: text('purpose'),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    department: text('department'),
    ownerEmployeeId: uuid('owner_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    ownerUserId: text('owner_user_id'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    venue: text('venue'),
    officeId: uuid('office_id').references(() => offices.id, { onDelete: 'set null' }),
    regionId: uuid('region_id').references(() => regions.id, { onDelete: 'set null' }),
    region: text('region'),
    expectedParticipants: integer('expected_participants'),
    plannedActivities: text('planned_activities'),
    estimatedTravelRequirement: text('estimated_travel_requirement'),
    estimatedKilometres: integer('estimated_kilometres'),

    // Workflow state
    status: text('status').notNull().default('draft'),
    reviewNotes: text('review_notes'),
    rejectionReason: text('rejection_reason'),
    createdByUserId: text('created_by_user_id').notNull(),
    reviewedByUserId: text('reviewed_by_user_id'),
    approvedByUserId: text('approved_by_user_id'),
    publishedByUserId: text('published_by_user_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_programmes_tenant_reference_v2')
      .on(table.tenantId, table.reference)
      .where(sql`${table.reference} ~ '^GRN/PGM/[0-9]{4}/[0-9]{6}$'`),
  ],
);
