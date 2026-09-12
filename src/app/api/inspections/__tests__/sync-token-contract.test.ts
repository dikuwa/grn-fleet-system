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
    expect(source).toContain('value.length > MAX_SYNC_ID_LENGTH');
    expect(source).toContain('value !== value.trim()');
    expect(source).toContain('decodeURIComponent(value) === value');
    expect(source).toContain("{ error: 'Invalid inspection sync identifier' }, { status: 422 }");
  });

  it('rejects malformed or encoded new tokens only after checking historical replay', () => {
    const existingLookupIndex = source.indexOf('hasExistingSyncInspection = Boolean(existingSyncInspection);');
    const tokenGuardIndex = source.indexOf('!isCanonicalNewSyncId(clientSyncId)');
    const serviceIndex = source.indexOf('const result = await completeOfficialInspection({');

    expect(source).toContain('function isCanonicalNewSyncId(value: string)');
    expect(source).toContain('try {');
    expect(source).toContain('catch {');
    expect(existingLookupIndex).toBeGreaterThan(-1);
    expect(tokenGuardIndex).toBeGreaterThan(existingLookupIndex);
    expect(serviceIndex).toBeGreaterThan(tokenGuardIndex);
  });
});
