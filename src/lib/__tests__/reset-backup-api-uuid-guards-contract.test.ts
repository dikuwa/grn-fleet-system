import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const pathRoutes = [
  'src/app/api/platform/reset/[id]/route.ts',
  'src/app/api/platform/reset/[id]/dry-run/route.ts',
  'src/app/api/platform/reset/[id]/backup/route.ts',
  'src/app/api/platform/reset/[id]/execute/route.ts',
  'src/app/api/admin/data-reset/[id]/execute/route.ts',
  'src/app/api/platform/backups/[id]/route.ts',
  'src/app/api/platform/backups/[id]/download/route.ts',
  'src/app/api/platform/backups/[id]/restore/route.ts',
] as const;

describe('reset and backup API UUID guards', () => {
  it.each(pathRoutes)('guards malformed path ids before UUID-backed work: %s', (path) => {
    const source = read(path);
    const params = source.indexOf('const { id } = await params');
    const guard = source.indexOf('if (!isUuid(id))', params);

    expect(source).toContain("import { isUuid } from '@/lib/uuid';");
    expect(params).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(params);
  });

  it('validates tenant-admin cancellation ids before reset-request predicates', () => {
    const source = read('src/app/api/admin/data-reset/route.ts');
    const bodyId = source.indexOf("const id = typeof body.id === 'string' ? body.id : ''");
    const guard = source.indexOf('if (!isUuid(id))', bodyId);
    const db = source.indexOf('const db = getDb()', guard);

    expect(source).toContain("import { isUuid } from '@/lib/uuid';");
    expect(bodyId).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(bodyId);
    expect(db).toBeGreaterThan(guard);
  });

  it('validates manual backup tenant ids and maps a missing tenant to 404', () => {
    const source = read('src/app/api/platform/backups/route.ts');
    const tenantId = source.indexOf("const tenantId = typeof body.tenantId === 'string'");
    const guard = source.indexOf('if (!isUuid(tenantId))', tenantId);
    const create = source.indexOf('await createTenantOperationalBackup({', guard);
    const missing = source.indexOf("/^Tenant not found\\.?$/i.test(message)", create);

    expect(tenantId).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(tenantId);
    expect(create).toBeGreaterThan(guard);
    expect(missing).toBeGreaterThan(create);
  });

  it('maps a valid but unavailable backup download to 404 without hiding storage failures', () => {
    const source = read('src/app/api/platform/backups/[id]/download/route.ts');
    const download = source.indexOf('await getBackupDownloadUrl(id)');
    const mapping = source.indexOf('/not found|not available for download/i.test(message)', download);

    expect(download).toBeGreaterThan(-1);
    expect(mapping).toBeGreaterThan(download);
    expect(source).not.toContain('/not found|storage not available/i');
  });

  it('validates schedule tenant/id inputs and returns 404 for missing deletes', () => {
    const source = read('src/app/api/platform/backups/schedules/route.ts');
    const tenantGuard = source.indexOf('if (tenantId && !isUuid(tenantId))');
    const patchGuard = source.indexOf('if (!isUuid(id))', tenantGuard);
    const deleteHandler = source.indexOf('export async function DELETE', patchGuard);
    const deleteGuard = source.indexOf('if (!isUuid(id))', deleteHandler);
    const returning = source.indexOf('.returning({ id: platformBackupSchedules.id })', deleteGuard);
    const missing = source.indexOf('if (!deleted)', returning);

    expect(tenantGuard).toBeGreaterThan(-1);
    expect(patchGuard).toBeGreaterThan(tenantGuard);
    expect(deleteGuard).toBeGreaterThan(deleteHandler);
    expect(returning).toBeGreaterThan(deleteGuard);
    expect(missing).toBeGreaterThan(returning);
  });
});
