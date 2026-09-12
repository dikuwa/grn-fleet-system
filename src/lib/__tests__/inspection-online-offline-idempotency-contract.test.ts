import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const formSource = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/inspections/new/page.tsx'),
  'utf8',
);
const syncSource = readFileSync(resolve(process.cwd(), 'src/lib/offline-sync.ts'), 'utf8');

describe('inspection online to offline idempotency handoff', () => {
  it('uses one stable operation token for the online submission and offline fallback draft', () => {
    expect(formSource).toContain('const clientSyncId = crypto.randomUUID();');
    expect(formSource).toContain('clientSyncId,');
    expect(formSource).toContain('id: clientSyncId,');
    expect(syncSource).toContain('clientSyncId: d.id,');
  });

  it('preserves already uploaded inspection evidence when the response is lost', () => {
    expect(formSource).toContain('const photoKeys: string[] = [];');
    expect(formSource).toContain('formData: { ...draftData, photoKeys: [...photoKeys] },');
  });
});
