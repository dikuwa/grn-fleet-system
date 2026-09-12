import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);

describe('inspection sync token creation contract', () => {
  it('keeps new sync tokens compatible with the recovery endpoint contract', () => {
    expect(source).toContain('const MAX_SYNC_ID_LENGTH = 128;');
    expect(source).toContain('!hasExistingSyncInspection &&');
    expect(source).toContain('clientSyncId.length > MAX_SYNC_ID_LENGTH');
    expect(source).toContain('clientSyncId !== clientSyncId.trim()');
    expect(source).toContain("{ error: 'Invalid inspection sync identifier' }, { status: 422 }");
  });

  it('checks for an existing token before rejecting a non-canonical new token', () => {
    const existingLookupIndex = source.indexOf('hasExistingSyncInspection = Boolean(existingSyncInspection);');
    const tokenGuardIndex = source.indexOf('clientSyncId.length > MAX_SYNC_ID_LENGTH');
    const serviceIndex = source.indexOf('const result = await completeOfficialInspection({');

    expect(existingLookupIndex).toBeGreaterThan(-1);
    expect(tokenGuardIndex).toBeGreaterThan(existingLookupIndex);
    expect(serviceIndex).toBeGreaterThan(tokenGuardIndex);
  });
});
