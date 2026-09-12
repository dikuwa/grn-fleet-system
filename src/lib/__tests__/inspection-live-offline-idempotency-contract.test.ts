import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/inspections/new/page.tsx'),
  'utf8',
);

describe('live inspection to offline idempotency handoff', () => {
  it('uses one sync identifier for the live POST and fallback draft', () => {
    const tokenIndex = source.indexOf('const clientSyncId = crypto.randomUUID();');
    const requestIndex = source.indexOf("const response = await fetch('/api/inspections'");
    const requestTokenIndex = source.indexOf('clientSyncId,', requestIndex);
    const saveDraftIndex = source.indexOf('await saveDraft({');
    const draftTokenIndex = source.indexOf('id: clientSyncId,', saveDraftIndex);

    expect(tokenIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(tokenIndex);
    expect(requestTokenIndex).toBeGreaterThan(requestIndex);
    expect(saveDraftIndex).toBeGreaterThan(requestIndex);
    expect(draftTokenIndex).toBeGreaterThan(saveDraftIndex);
  });

  it('preserves already-uploaded inspection photo keys in the fallback draft', () => {
    const photoKeysIndex = source.indexOf('const photoKeys: string[] = [];');
    const draftDataIndex = source.indexOf('const draftData = {');
    const draftPhotoKeysIndex = source.indexOf('photoKeys,', draftDataIndex);
    const uploadPushIndex = source.indexOf('photoKeys.push(uploaded.data.key);');

    expect(photoKeysIndex).toBeGreaterThan(-1);
    expect(draftDataIndex).toBeGreaterThan(photoKeysIndex);
    expect(draftPhotoKeysIndex).toBeGreaterThan(draftDataIndex);
    expect(uploadPushIndex).toBeGreaterThan(draftPhotoKeysIndex);
  });
});
