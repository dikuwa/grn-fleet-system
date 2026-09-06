import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-reset-snapshot.ts'),
  'utf8',
);
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/platform/route.ts'),
  'utf8',
);

describe('platform operational snapshot freshness', () => {
  it('hashes canonical full rows across every reset table instead of parent ids only', () => {
    const fingerprint = source.indexOf('export function platformOperationalSnapshotFingerprint');
    const canonical = source.indexOf('canonicalize(row)', fingerprint);
    const tables = [
      "table: 'cms_enquiries'",
      "table: 'demo_requests'",
      "table: 'notifications'",
      "table: 'notification_deliveries'",
      "table: 'notification_reads'",
      "table: 'notification_dismissals'",
    ];

    expect(fingerprint).toBeGreaterThan(-1);
    expect(canonical).toBeGreaterThan(fingerprint);
    tables.forEach((table) => expect(source).toContain(table));
  });

  it('verifies the uploaded archive against a locked fresh recapture before accepting it', () => {
    const create = source.indexOf('export async function createVerifiedPlatformOperationalBackup');
    const archiveRead = source.indexOf('await readPlatformOperationalBackup(backup.id)', create);
    const archiveFingerprint = source.indexOf(
      'platformOperationalSnapshotFingerprint(payload.tables)',
      archiveRead,
    );
    const transaction = source.indexOf('await db.transaction(async (tx) => {', archiveFingerprint);
    const tableLock = source.indexOf('LOCK TABLE platform_backups', transaction);
    const recapture = source.indexOf('await capturePlatformOperationalSnapshot(tx)', tableLock);
    const mismatch = source.indexOf(
      'current.snapshotFingerprint !== archiveSnapshotFingerprint',
      recapture,
    );
    const metadata = source.indexOf("'platformSnapshotVersion', 2", mismatch);

    expect(create).toBeGreaterThan(-1);
    expect(archiveRead).toBeGreaterThan(create);
    expect(archiveFingerprint).toBeGreaterThan(archiveRead);
    expect(transaction).toBeGreaterThan(archiveFingerprint);
    expect(tableLock).toBeGreaterThan(transaction);
    expect(recapture).toBeGreaterThan(tableLock);
    expect(mismatch).toBeGreaterThan(recapture);
    expect(metadata).toBeGreaterThan(mismatch);
  });

  it('fences verification failure writes to the exact ready archive checksum', () => {
    const create = source.indexOf('export async function createVerifiedPlatformOperationalBackup');
    const failure = source.indexOf("status: 'failed'", create);
    const readyFence = source.indexOf("eq(platformBackups.status, 'ready')", failure);
    const checksumFence = source.indexOf('eq(platformBackups.checksum, backupChecksum)', readyFence);

    expect(failure).toBeGreaterThan(create);
    expect(readyFence).toBeGreaterThan(failure);
    expect(checksumFence).toBeGreaterThan(readyFence);
  });

  it('revalidates the verified snapshot under table locks before destructive execution', () => {
    const execute = source.indexOf('export async function executeVerifiedPlatformOperationalReset');
    const transaction = source.indexOf('await db.transaction(async (tx) => {', execute);
    const tableLock = source.indexOf('LOCK TABLE platform_backups', transaction);
    const backupCheck = source.indexOf('const [currentBackup]', tableLock);
    const recapture = source.indexOf('await capturePlatformOperationalSnapshot(tx)', backupCheck);
    const snapshotGuard = source.indexOf(
      'snapshot.snapshotFingerprint !== storedSnapshotFingerprint',
      recapture,
    );
    const firstDelete = source.indexOf('.delete(notificationDeliveries)', snapshotGuard);

    expect(execute).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(execute);
    expect(tableLock).toBeGreaterThan(transaction);
    expect(backupCheck).toBeGreaterThan(tableLock);
    expect(recapture).toBeGreaterThan(backupCheck);
    expect(snapshotGuard).toBeGreaterThan(recapture);
    expect(firstDelete).toBeGreaterThan(snapshotGuard);
  });

  it('rejects legacy platform recovery points that lack a verified snapshot hash for execution', () => {
    const versionCheck = source.indexOf('backupMetadata.platformSnapshotVersion !== 2');
    const freshMessage = source.indexOf(
      'Create a fresh verified platform recovery point before executing this reset.',
      versionCheck,
    );

    expect(versionCheck).toBeGreaterThan(-1);
    expect(freshMessage).toBeGreaterThan(versionCheck);
  });

  it('routes platform backup creation and execution through the verified snapshot helpers', () => {
    expect(route).toContain(
      "import {\n  createVerifiedPlatformOperationalBackup,\n  executeVerifiedPlatformOperationalReset,\n} from '@/lib/data-protection/platform-reset-snapshot';",
    );
    expect(route).toContain('await createVerifiedPlatformOperationalBackup({');
    expect(route).toContain('await executeVerifiedPlatformOperationalReset({');
    expect(route).not.toContain('await createPlatformOperationalBackup({');
    expect(route).not.toContain('await executePlatformOperationalReset({');
  });
});
