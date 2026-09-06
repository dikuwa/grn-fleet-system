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

  it('validates root reset enum filters before query construction', () => {
    const source = read('src/app/api/platform/reset/route.ts');
    const statusSet = source.indexOf('const RESET_STATUSES = new Set<string>(resetRequestStatusEnum.enumValues)');
    const scopeSet = source.indexOf('const RESET_SCOPES = new Set<string>(resetScopeEnum.enumValues)');
    const statusGuard = source.indexOf('if (status && !RESET_STATUSES.has(status))');
    const scopeGuard = source.indexOf('if (scope && !RESET_SCOPES.has(scope))', statusGuard);
    const db = source.indexOf('const db = getDb()', scopeGuard);

    expect(statusSet).toBeGreaterThan(-1);
    expect(scopeSet).toBeGreaterThan(statusSet);
    expect(statusGuard).toBeGreaterThan(scopeSet);
    expect(scopeGuard).toBeGreaterThan(statusGuard);
    expect(db).toBeGreaterThan(scopeGuard);
  });

  it('validates root reset target and tenant UUID before tenant lookup', () => {
    const source = read('src/app/api/platform/reset/route.ts');
    const targetGuard = source.indexOf("if (target !== 'tenant' && target !== 'platform')");
    const tenantGuard = source.indexOf("if (target === 'tenant' && tenantId && !isUuid(tenantId))", targetGuard);
    const tenantLookup = source.indexOf('.where(eq(tenants.id, tenantId))', tenantGuard);

    expect(source).toContain("import { isUuid } from '@/lib/uuid';");
    expect(targetGuard).toBeGreaterThan(-1);
    expect(tenantGuard).toBeGreaterThan(targetGuard);
    expect(tenantLookup).toBeGreaterThan(tenantGuard);
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

  it('normalizes malformed backup list pagination before SQL-backed listing', () => {
    const source = read('src/app/api/platform/backups/route.ts');
    const parser = source.indexOf('function positiveIntegerParam(value: string | null, fallback: number)');
    const integerGuard = source.indexOf('Number.isInteger(parsed) && parsed > 0 ? parsed : fallback', parser);
    const page = source.indexOf("const page = positiveIntegerParam(searchParams.get('page'), 1)", integerGuard);
    const limit = source.indexOf("const limit = positiveIntegerParam(searchParams.get('limit'), 20)", page);
    const list = source.indexOf('listBackups({ view, page, limit })', limit);

    expect(parser).toBeGreaterThan(-1);
    expect(integerGuard).toBeGreaterThan(parser);
    expect(page).toBeGreaterThan(integerGuard);
    expect(limit).toBeGreaterThan(page);
    expect(list).toBeGreaterThan(limit);
  });

  it('validates manual backup retention and tenant existence before storage work', () => {
    const source = read('src/app/api/platform/backups/route.ts');
    const tenantId = source.indexOf("const tenantId = typeof body.tenantId === 'string'");
    const retention = source.indexOf('const retentionDays = body.retentionDays == null ? 30 : Number(body.retentionDays)', tenantId);
    const uuidGuard = source.indexOf('if (!isUuid(tenantId))', retention);
    const retentionGuard = source.indexOf('if (!Number.isInteger(retentionDays)', uuidGuard);
    const tenantLookup = source.indexOf('.from(tenants)', retentionGuard);
    const missingTenant = source.indexOf("if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })", tenantLookup);
    const create = source.indexOf('await createTenantOperationalBackup({', missingTenant);

    expect(tenantId).toBeGreaterThan(-1);
    expect(retention).toBeGreaterThan(tenantId);
    expect(uuidGuard).toBeGreaterThan(retention);
    expect(retentionGuard).toBeGreaterThan(uuidGuard);
    expect(tenantLookup).toBeGreaterThan(retentionGuard);
    expect(missingTenant).toBeGreaterThan(tenantLookup);
    expect(create).toBeGreaterThan(missingTenant);
  });

  it('maps a valid but unavailable backup download to 404 without hiding storage failures', () => {
    const source = read('src/app/api/platform/backups/[id]/download/route.ts');
    const download = source.indexOf('await getBackupDownloadUrl(id)');
    const mapping = source.indexOf('/not found|not available for download/i.test(message)', download);

    expect(download).toBeGreaterThan(-1);
    expect(mapping).toBeGreaterThan(download);
    expect(source).not.toContain('/not found|storage not available/i');
  });

  it('maps expected restore-state and archive-integrity preconditions to 409', () => {
    const source = read('src/app/api/platform/backups/[id]/restore/route.ts');
    const restore = source.indexOf('await restoreTenantOperationalBackup({');
    const classifier = source.indexOf(
      '/blocked|confirmation|already been restored|clean|changed|not ready|integrity|checksum|unsupported backup format|tenant identity|archive is empty|archive could not be found|archive is invalid|does not match|no longer linked/i.test(',
      restore,
    );
    const status = source.indexOf('const status = /not found/i.test(message) ? 404 : conflict ? 409 : 500', classifier);

    expect(restore).toBeGreaterThan(-1);
    expect(classifier).toBeGreaterThan(restore);
    expect(status).toBeGreaterThan(classifier);
    expect(source).not.toContain('archive could not be downloaded|');
  });

  it('validates schedule tenant/id and retention inputs and returns 404 for missing deletes', () => {
    const source = read('src/app/api/platform/backups/schedules/route.ts');
    const retentionParser = source.indexOf('function parseRetentionDays(value: unknown, fallback: number)');
    const finiteGuard = source.indexOf('if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) return null', retentionParser);
    const tenantGuard = source.indexOf('if (tenantId && !isUuid(tenantId))', finiteGuard);
    const postRetention = source.indexOf('const retentionDays = parseRetentionDays(body.retentionDays, 90)', tenantGuard);
    const postRetentionGuard = source.indexOf('if (retentionDays == null)', postRetention);
    const patchGuard = source.indexOf('if (!isUuid(id))', postRetentionGuard);
    const patchRetention = source.indexOf('const retentionDays = parseRetentionDays(body.retentionDays, current.retentionDays)', patchGuard);
    const patchRetentionGuard = source.indexOf('if (retentionDays == null)', patchRetention);
    const deleteHandler = source.indexOf('export async function DELETE', patchRetentionGuard);
    const deleteGuard = source.indexOf('if (!isUuid(id))', deleteHandler);
    const returning = source.indexOf('.returning({ id: platformBackupSchedules.id })', deleteGuard);
    const missing = source.indexOf('if (!deleted)', returning);

    expect(retentionParser).toBeGreaterThan(-1);
    expect(finiteGuard).toBeGreaterThan(retentionParser);
    expect(tenantGuard).toBeGreaterThan(finiteGuard);
    expect(postRetention).toBeGreaterThan(tenantGuard);
    expect(postRetentionGuard).toBeGreaterThan(postRetention);
    expect(patchGuard).toBeGreaterThan(postRetentionGuard);
    expect(patchRetention).toBeGreaterThan(patchGuard);
    expect(patchRetentionGuard).toBeGreaterThan(patchRetention);
    expect(deleteGuard).toBeGreaterThan(deleteHandler);
    expect(returning).toBeGreaterThan(deleteGuard);
    expect(missing).toBeGreaterThan(returning);
  });
});
