import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'src/db/migrations/0100_trip_fuel_closure_serialization.sql'),
  'utf8',
);
const fuelRoute = readFileSync(
  join(process.cwd(), 'src/app/api/fuel/route.ts'),
  'utf8',
);

const closedTripGuard = readFileSync(
  join(process.cwd(), 'src/db/migrations/0068_closed_trip_financial_immutability.sql'),
  'utf8',
);

describe('trip fuel closure race guard', () => {
  it('locks the linked trip before a fresh fuel insert can commit', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION serialize_trip_fuel_with_closure()');
    expect(migration).toContain('IF NEW.trip_id IS NULL THEN');
    expect(migration).toContain('t.id = NEW.trip_id');
    expect(migration).toContain('FOR UPDATE OF t;');
    expect(migration).toContain('BEFORE INSERT ON fuel_transactions');
  });

  it('reuses the existing explicit closed-trip conflict contract', () => {
    expect(migration).toContain("RAISE EXCEPTION 'closed_trip_financial_immutable:%', NEW.trip_id");
    expect(migration).toContain("ERRCODE = '23514'");
    expect(fuelRoute).toContain("code === '23514' && message.includes('closed_trip_financial_immutable')");
    expect(fuelRoute).toContain("{ status: 409 }");
  });

  it('preserves the broader immutable-after-close trigger alongside serialization', () => {
    expect(closedTripGuard).toContain('CREATE TRIGGER trg_freeze_closed_trip_fuel');
    expect(closedTripGuard).toContain('BEFORE INSERT OR UPDATE OR DELETE ON fuel_transactions');
    expect(migration).toContain('DROP TRIGGER IF EXISTS trg_serialize_trip_fuel_with_closure ON fuel_transactions');
  });

  it('preserves committed clientSyncId replay before fresh insertion', () => {
    const replayLookup = fuelRoute.indexOf('eq(fuelTransactions.clientSyncId, syncId)');
    const fuelInsert = fuelRoute.indexOf('executor.insert(fuelTransactions).values({');

    expect(replayLookup).toBeGreaterThanOrEqual(0);
    expect(fuelInsert).toBeGreaterThan(replayLookup);
  });
});
