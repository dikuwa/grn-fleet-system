import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/external-parties/[id]/licences/route.ts'),
  'utf8',
);

describe('external licence upload party/version serialization', () => {
  it('rejects malformed party ids before UUID-backed database access', () => {
    const permissionIndex = source.indexOf('const permissionCheck = await requireAnyPermission');
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(partyId))');
    const dbIndex = source.indexOf('const db = getDb();', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(source).toContain("{ error: 'External party not found' }, { status: 404 }");
  });

  it('locks and revalidates the active external party before allocating the next version', () => {
    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {');
    const partyLockIndex = source.indexOf(".for('update')", transactionIndex);
    const versionIndex = source.indexOf('COALESCE(MAX(${externalDriverLicences.version}), 0) + 1', transactionIndex);
    const insertIndex = source.indexOf('.insert(externalDriverLicences)', transactionIndex);

    expect(source).toContain("eq(externalParties.status, 'active')");
    expect(source).toContain('if (!lockedParty) throw new Error(EXTERNAL_PARTY_UPLOAD_CONFLICT)');
    expect(partyLockIndex).toBeGreaterThan(transactionIndex);
    expect(versionIndex).toBeGreaterThan(partyLockIndex);
    expect(insertIndex).toBeGreaterThan(versionIndex);
  });

  it('records upload audit evidence in the successful transaction and maps a lost party claim to 409', () => {
    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {');
    const auditIndex = source.indexOf('await recordAuditEvent({', transactionIndex);
    expect(auditIndex).toBeGreaterThan(transactionIndex);
    expect(source.slice(auditIndex)).toContain('}, tx);');
    expect(source).toContain('error.message === EXTERNAL_PARTY_UPLOAD_CONFLICT');
    expect(source).toContain('{ status: 409 }');
  });
});
