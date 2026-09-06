import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-restore-service.ts'),
  'utf8',
);
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/backups/[id]/restore/route.ts'),
  'utf8',
);

describe('platform operational restore atomicity', () => {
  it('downloads before locking, then serializes, locks tables, revalidates, restores and marks restored in one transaction', () => {
    const archiveRead = service.indexOf('await readPlatformOperationalBackup(input.backupId)');
    const transaction = service.indexOf('await db.transaction(async (tx) => {', archiveRead);
    const advisory = service.indexOf('pg_advisory_xact_lock', transaction);
    const tableLock = service.indexOf('LOCK TABLE platform_backups', advisory);
    const backupRead = service.indexOf('.from(platformBackups)', tableLock);
    const targetCount = service.indexOf('WITH target_notifications AS', backupRead);
    const restoreLoop = service.indexOf('for (const table of PLATFORM_OPERATIONAL_TABLES)', targetCount);
    const markRestored = service.indexOf('.update(platformBackups)', restoreLoop);
    const restoredFence = service.indexOf('isNull(platformBackups.restoredAt)', markRestored);

    expect(archiveRead).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(archiveRead);
    expect(advisory).toBeGreaterThan(transaction);
    expect(tableLock).toBeGreaterThan(advisory);
    expect(backupRead).toBeGreaterThan(tableLock);
    expect(targetCount).toBeGreaterThan(backupRead);
    expect(restoreLoop).toBeGreaterThan(targetCount);
    expect(markRestored).toBeGreaterThan(restoreLoop);
    expect(restoredFence).toBeGreaterThan(markRestored);
  });

  it('routes platform recovery points through the atomic restore helper', () => {
    expect(route).toContain(
      "import { restorePlatformOperationalBackupAtomically } from '@/lib/data-protection/platform-restore-service';",
    );
    expect(route).toContain('await restorePlatformOperationalBackupAtomically({');
    expect(route).not.toContain('await restorePlatformOperationalBackup({');
  });
});
