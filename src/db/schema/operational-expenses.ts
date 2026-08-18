import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { vehicles } from './fleet';
import { trips } from './trips';
import { fleetPaymentInstruments, fleetPaymentTransactions } from './fleet-payments';

/**
 * Extended mapping for the existing trip_expenses table.
 *
 * The historical table name is intentionally retained so trip-linked and
 * vehicle-only operational costs remain one ledger. This mapping is used by
 * the generic expense API while the legacy trip operations endpoint keeps
 * its existing mapping for backwards compatibility.
 */
export const operationalExpenses = pgTable(
  'trip_expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    clientSyncId: text('client_sync_id'),
    category: text('category').notNull(),
    supplier: text('supplier'),
    transactionAt: timestamp('transaction_at', { withTimezone: true }).notNull(),
    referenceNumber: text('reference_number'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('NAD'),
    odometerReading: integer('odometer_reading'),
    receiptKey: text('receipt_key'),
    paymentMethod: text('payment_method').notNull().default('unspecified'),
    paymentInstrumentId: uuid('payment_instrument_id').references(() => fleetPaymentInstruments.id, {
      onDelete: 'set null',
    }),
    fleetPaymentTransactionId: uuid('fleet_payment_transaction_id').references(
      () => fleetPaymentTransactions.id,
      { onDelete: 'set null' },
    ),
    verificationStatus: text('verification_status').notNull().default('awaiting_verification'),
    notes: text('notes'),
    enteredByUserId: text('entered_by_user_id').notNull(),
    verifiedByUserId: text('verified_by_user_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_trip_expenses_tenant_sync').on(table.tenantId, table.clientSyncId),
    index('idx_trip_expenses_trip').on(table.tripId),
    index('idx_trip_expenses_vehicle').on(table.vehicleId),
    index('idx_trip_expenses_tenant_transaction').on(table.tenantId, table.transactionAt),
    index('idx_trip_expenses_payment_instrument').on(table.paymentInstrumentId),
  ],
);

export const OPERATIONAL_EXPENSE_CATEGORIES = [
  'fuel',
  'oil',
  'parking',
  'toll',
  'car_wash',
  'minor_consumables',
  'emergency_repair',
  'tyre_service',
  'accommodation',
  'driver_subsistence',
  'other',
] as const;

export const OPERATIONAL_PAYMENT_METHODS = [
  'fleet_payment',
  'cash',
  'eft',
  'personal_reimbursement',
  'other',
  'unspecified',
] as const;

export type OperationalExpenseCategory = (typeof OPERATIONAL_EXPENSE_CATEGORIES)[number];
export type OperationalPaymentMethod = (typeof OPERATIONAL_PAYMENT_METHODS)[number];
