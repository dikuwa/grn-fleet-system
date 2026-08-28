import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrapperSource = readFileSync(new URL('./reset-service.ts', import.meta.url), 'utf8');
const cleanupSource = readFileSync(new URL('./reset-storage-cleanup.ts', import.meta.url), 'utf8');

describe('governed tenant reset storage cleanup boundary', () => {
  it('collects reset-owned file keys before executing the database reset', () => {
    const collectIndex = wrapperSource.indexOf('collectAdvancedResetStorageKeys');
    const executeIndex = wrapperSource.indexOf('executeApprovedTenantOperationalResetCore(input)');

    expect(collectIndex).toBeGreaterThan(-1);
    expect(executeIndex).toBeGreaterThan(collectIndex);
    expect(wrapperSource).toContain("advancedPlan.resetSpec.categories.includes('operations') ? plan.fileKeys : []");
  });

  it('only removes storage after the core database mutation succeeds', () => {
    expect(wrapperSource).toContain(
      'const databaseMutationSucceeded = result.outcomes.every((outcome) => !outcome.error);',
    );
    expect(wrapperSource).toContain(
      'databaseMutationSucceeded\n    ? await removeApprovedResetStorageFiles(storageKeys)',
    );
    expect(wrapperSource).toContain("action: 'reset_request.storage_cleanup_completed'");
  });

  it('preserves failed or unavailable storage objects for operator follow-up', () => {
    expect(cleanupSource).toContain('if (!isStorageConfigured()) return { removed: [], preserved: uniqueKeys };');
    expect(cleanupSource).toContain('preserved.push(key);');
    expect(wrapperSource).toContain('storageFilesPreserved: storage.preserved.length');
  });

  it('captures selective reset storage columns instead of only operational plan keys', () => {
    expect(wrapperSource).toContain('collectAdvancedResetStorageKeys');
    expect(cleanupSource).toContain('step.fileKeyColumns');
    expect(cleanupSource).toContain('step.condition');
  });
});
