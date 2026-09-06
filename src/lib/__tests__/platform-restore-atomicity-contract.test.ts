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
    const normalizedCount = service.indexOf('firstExecuteRow(targetCountResult)', targetCount);
    const restoreLoop = service.indexOf(
      'for (const table of PLATFORM_OPERATIONAL_TABLES)',
      normalizedCount,
    );
    const markRestored = service.indexOf('.update(platformBackups)', restoreLoop);
    const restoredFence = service.indexOf('isNull(platformBackups.restoredAt)', markRestored);

    expect(archiveRead).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(archiveRead);
    expect(advisory).toBeGreaterThan(transaction);
    expect(tableLock).toBeGreaterThan(advisory);
    expect(backupRead).toBeGreaterThan(tableLock);
    expect(targetCount).toBeGreaterThan(backupRead);
    expect(normalizedCount).toBeGreaterThan(targetCount);
    expect(restoreLoop).toBeGreaterThan(normalizedCount);
    expect(markRestored).toBeGreaterThan(restoreLoop);
    expect(restoredFence).toBeGreaterThan(markRestored);
  });

  it('reads raw execute rows from both postgres.js arrays and Neon rows objects', () => {
    const helper = service.indexOf('function firstExecuteRow(result: unknown)');
    const arrayCase = service.indexOf('if (Array.isArray(result))', helper);
    const rowsCase = service.indexOf('.rows?.[0]', arrayCase);

    expect(helper).toBeGreaterThan(-1);
    expect(arrayCase).toBeGreaterThan(helper);
    expect(rowsCase).toBeGreaterThan(arrayCase);
  });

  it('keeps sandbox-backed demo requests and their notifications outside the restore target precheck', () => {
    const demoNotification = service.indexOf("n.entity_type = 'demo_request'");
    const sandboxJoin = service.indexOf(
      'LEFT JOIN demo_sandboxes ds ON ds.demo_request_id = dr.id',
      demoNotification,
    );
    const sandboxGuard = service.indexOf('AND ds.id IS NULL', sandboxJoin);

    expect(demoNotification).toBeGreaterThan(-1);
    expect(sandboxJoin).toBeGreaterThan(demoNotification);
    expect(sandboxGuard).toBeGreaterThan(sandboxJoin);
  });

  it('routes platform recovery points through the atomic restore helper', () => {
    expect(route).toContain(
      "import { restorePlatformOperationalBackupAtomically } from '@/lib/data-protection/platform-restore-service';",
    );
    expect(route).toContain('await restorePlatformOperationalBackupAtomically({');
    expect(route).not.toContain('await restorePlatformOperationalBackup({');
  });
});
