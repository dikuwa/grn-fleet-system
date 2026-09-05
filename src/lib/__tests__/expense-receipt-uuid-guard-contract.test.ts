import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/expenses/receipts/route.ts'),
  'utf8',
);

describe('expense receipt UUID guards', () => {
  it('preserves access, storage and receipt validation before id guards', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const storageIndex = source.indexOf('if (!isStorageConfigured())');
    const typeIndex = source.indexOf('if (!EXPENSE_RECEIPT_TYPES.has(file.type))');
    const sizeIndex = source.indexOf('if (file.size > UPLOAD_MAX_SIZE_BYTES)');
    const driverTripIndex = source.indexOf('if (!tripId && !canManage)');
    const tripGuardIndex = source.indexOf('if (tripId && !UUID_PATTERN.test(tripId))');
    const dbIndex = source.indexOf('const db = getDb();', tripGuardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(storageIndex).toBeGreaterThan(authIndex);
    expect(typeIndex).toBeGreaterThan(storageIndex);
    expect(sizeIndex).toBeGreaterThan(typeIndex);
    expect(driverTripIndex).toBeGreaterThan(sizeIndex);
    expect(tripGuardIndex).toBeGreaterThan(driverTripIndex);
    expect(dbIndex).toBeGreaterThan(tripGuardIndex);
  });

  it('uses existing privacy-safe trip and vehicle not-found surfaces', () => {
    const guardStart = source.indexOf('if (tripId && !UUID_PATTERN.test(tripId))');
    const dbIndex = source.indexOf('const db = getDb();', guardStart);
    const guards = source.slice(guardStart, dbIndex);

    expect(guards).toContain("{ error: 'Trip not found or not assigned to you' }");
    expect(guards).toContain("{ error: 'Vehicle not found in this tenant' }");
    expect(guards.match(/\{ status: 404 \}/g)).toHaveLength(2);
  });

  it('does not reject a supplied vehicle id when a valid trip will authoritatively replace it', () => {
    expect(source).toContain('if (!tripId && vehicleId && !UUID_PATTERN.test(vehicleId))');
  });
});
