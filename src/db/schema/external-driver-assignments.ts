import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { externalParties, externalDriverLicences } from './external-parties';
import { transportRequests } from './requests';
import { vehicleAllocations, trips } from './trips';

/**
 * Final external-driver assignment lifecycle.
 *
 * External people never occupy employee driver foreign keys. The allocation
 * remains linked to the vehicle/trip while this record carries external
 * identity, verified licence snapshot and staff-recorded acceptance evidence.
 */
export const externalDriverAssignments = pgTable(
  'external_driver_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => transportRequests.id, { onDelete: 'cascade' }),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => vehicleAllocations.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    externalPartyId: uuid('external_party_id')
      .notNull()
      .references(() => externalParties.id),
    licenceId: uuid('licence_id')
      .notNull()
      .references(() => externalDriverLicences.id),
    state: text('state').notNull().default('pending_acceptance'),
    driverType: text('driver_type').notNull().default('assigned'),
    licenceSnapshot: jsonb('licence_snapshot').$type<Record<string, unknown>>().notNull(),
    assignedByUserId: text('assigned_by_user_id').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    acceptanceMethod: text('acceptance_method'),
    acceptanceNote: text('acceptance_note'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedRecordedByUserId: text('accepted_recorded_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    cancelledByUserId: text('cancelled_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_external_driver_assignments_tenant_state').on(table.tenantId, table.state),
    index('idx_external_driver_assignments_request').on(table.requestId),
    index('idx_external_driver_assignments_trip').on(table.tripId),
    index('idx_external_driver_assignments_party').on(table.externalPartyId),
    uniqueIndex('uq_external_driver_assignment_live_allocation')
      .on(table.allocationId)
      .where(sql`${table.state} in ('pending_acceptance', 'accepted')`),
    uniqueIndex('uq_external_driver_assignment_live_trip')
      .on(table.tripId)
      .where(sql`${table.state} in ('pending_acceptance', 'accepted')`),
  ],
);
