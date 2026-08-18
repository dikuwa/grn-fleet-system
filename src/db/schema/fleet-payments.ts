import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { vehicles } from './fleet';
import { employees } from './people';
import { externalParties } from './external-parties';
import { trips, vehicleAllocations } from './trips';

export const FLEET_PAYMENT_PROVIDER_TYPES = [
  'standard_bank_bluefuel',
  'fnb_fleet',
  'other_bank_fleet',
  'company_account',
  'manual',
] as const;

export const FLEET_PAYMENT_INTEGRATION_MODES = ['manual', 'file_import', 'api'] as const;
export const FLEET_PAYMENT_INSTRUMENT_TYPES = ['card', 'vehicle_tag', 'virtual', 'account', 'other'] as const;
export const FLEET_PAYMENT_STATUSES = ['active', 'inactive', 'blocked', 'lost', 'expired', 'replaced'] as const;
export const FLEET_PAYMENT_TRANSACTION_STATUSES = ['approved', 'declined', 'reversed', 'pending'] as const;
export const FLEET_PAYMENT_TRANSACTION_SOURCES = ['manual', 'file_import', 'api'] as const;
export const FLEET_PAYMENT_RECONCILIATION_STATUSES = ['unmatched', 'likely_match', 'matched', 'exception'] as const;

/** Tenant-owned fleet payment provider. Secrets are referenced by environment/secret-manager key only. */
export const fleetPaymentProviders = pgTable(
  'fleet_payment_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    providerType: text('provider_type').notNull(),
    providerName: text('provider_name').notNull(),
    integrationMode: text('integration_mode').notNull().default('manual'),
    isDefault: boolean('is_default').notNull().default(false),
    requireForRelease: boolean('require_for_release').notNull().default(false),
    status: text('status').notNull().default('active'),
    apiBaseUrl: text('api_base_url'),
    apiClientId: text('api_client_id'),
    apiSecretEnvKey: text('api_secret_env_key'),
    externalAccountReference: text('external_account_reference'),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fleet_payment_providers_tenant').on(table.tenantId),
    uniqueIndex('uq_fleet_payment_provider_type_tenant').on(table.tenantId, table.providerType),
  ],
);

/** Physical/virtual credential or vehicle tag. Full card/PIN secrets are never stored. */
export const fleetPaymentInstruments = pgTable(
  'fleet_payment_instruments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id').notNull().references(() => fleetPaymentProviders.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    instrumentType: text('instrument_type').notNull().default('card'),
    displayName: text('display_name'),
    maskedIdentifier: text('masked_identifier').notNull(),
    externalReference: text('external_reference'),
    status: text('status').notNull().default('active'),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    allowedCategories: jsonb('allowed_categories').$type<string[]>().default([]),
    spendingLimit: numeric('spending_limit', { precision: 12, scale: 2 }),
    currency: text('currency').notNull().default('NAD'),
    notes: text('notes'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fleet_payment_instruments_tenant_status').on(table.tenantId, table.status),
    index('idx_fleet_payment_instruments_vehicle').on(table.vehicleId),
    uniqueIndex('uq_fleet_payment_instrument_external').on(table.providerId, table.externalReference),
  ],
);

/** Time-bounded assignment captures who had access to which instrument for an allocation/trip. */
export const fleetPaymentAssignments = pgTable(
  'fleet_payment_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id').notNull().references(() => fleetPaymentInstruments.id, { onDelete: 'restrict' }),
    allocationId: uuid('allocation_id').references(() => vehicleAllocations.id, { onDelete: 'set null' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'restrict' }),
    driverEmployeeId: uuid('driver_employee_id').references(() => employees.id, { onDelete: 'set null' }),
    externalDriverId: uuid('external_driver_id').references(() => externalParties.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('assigned'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedByUserId: text('assigned_by_user_id').notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnedByUserId: text('returned_by_user_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_fleet_payment_assignments_trip').on(table.tripId),
    index('idx_fleet_payment_assignments_allocation').on(table.allocationId),
    index('idx_fleet_payment_assignments_instrument').on(table.instrumentId),
  ],
);

/** Provider-neutral bank/fleet transaction ledger used for manual, file and future API sync. */
export const fleetPaymentTransactions = pgTable(
  'fleet_payment_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id').notNull().references(() => fleetPaymentProviders.id, { onDelete: 'restrict' }),
    instrumentId: uuid('instrument_id').references(() => fleetPaymentInstruments.id, { onDelete: 'set null' }),
    assignmentId: uuid('assignment_id').references(() => fleetPaymentAssignments.id, { onDelete: 'set null' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    driverEmployeeId: uuid('driver_employee_id').references(() => employees.id, { onDelete: 'set null' }),
    externalDriverId: uuid('external_driver_id').references(() => externalParties.id, { onDelete: 'set null' }),
    externalTransactionId: text('external_transaction_id'),
    transactionAt: timestamp('transaction_at', { withTimezone: true }).notNull(),
    merchant: text('merchant'),
    location: text('location'),
    category: text('category').notNull(),
    litres: numeric('litres', { precision: 10, scale: 2 }),
    unitPrice: numeric('unit_price', { precision: 10, scale: 3 }),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('NAD'),
    odometerReading: integer('odometer_reading'),
    status: text('status').notNull().default('approved'),
    source: text('source').notNull().default('manual'),
    reconciliationStatus: text('reconciliation_status').notNull().default('unmatched'),
    reconciliationConfidence: integer('reconciliation_confidence'),
    matchedExpenseId: uuid('matched_expense_id'),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>().default({}),
    importedByUserId: text('imported_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_fleet_payment_transaction_external').on(table.providerId, table.externalTransactionId),
    index('idx_fleet_payment_transactions_tenant_time').on(table.tenantId, table.transactionAt),
    index('idx_fleet_payment_transactions_reconciliation').on(table.tenantId, table.reconciliationStatus),
    index('idx_fleet_payment_transactions_vehicle').on(table.vehicleId),
  ],
);

export type FleetPaymentProviderType = (typeof FLEET_PAYMENT_PROVIDER_TYPES)[number];
export type FleetPaymentIntegrationMode = (typeof FLEET_PAYMENT_INTEGRATION_MODES)[number];
