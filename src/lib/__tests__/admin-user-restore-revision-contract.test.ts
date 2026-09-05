import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/restore/route.ts'),
  'utf8',
);

describe('admin user restore revision claim', () => {
  it('claims access_removed before restoring and audits in the same transaction', () => {
    expect(source).toContain("const USER_RESTORE_CONFLICT = 'user_restore_conflict'");
    expect(source).toContain("eq(tenantMemberships.status, 'access_removed')");
    expect(source).toContain('.returning({ id: tenantMemberships.id })');
    expect(source).toContain('if (!restoredMembership) throw new Error(USER_RESTORE_CONFLICT)');

    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {');
    const claimIndex = source.indexOf('const [restoredMembership] = await tx');
    const auditIndex = source.indexOf('await recordAuditEvent({');
    expect(claimIndex).toBeGreaterThan(transactionIndex);
    expect(auditIndex).toBeGreaterThan(claimIndex);
    expect(source.slice(auditIndex)).toContain('}, tx);');
  });

  it('maps a lost restore race to controlled 409', () => {
    expect(source).toContain('error.message === USER_RESTORE_CONFLICT');
    expect(source).toContain(
      'This account changed while it was being restored. Refresh User Management and review its current access state.',
    );
    expect(source).toContain('{ status: 409 }');
  });
});
