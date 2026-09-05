import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/reset-password/route.ts'),
  'utf8',
);

describe('admin password reset serialization', () => {
  it('requires an existing email password credential before reporting a reset', () => {
    expect(source).toContain("eq(account.providerId, 'email')");
    expect(source).toContain('if (!credential?.password)');
    expect(source).toContain('This user has no email password credential to reset.');
    expect(source).toContain('{ status: 409 }');
  });

  it('locks tenant membership and claims the exact reviewed password hash', () => {
    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {');
    const membershipLockIndex = source.indexOf(".for('update')", transactionIndex);
    const credentialClaimIndex = source.indexOf('const [rotatedCredential] = await tx', transactionIndex);

    expect(source).toContain("const PASSWORD_RESET_CONFLICT = 'password_reset_conflict'");
    expect(source).toContain('const previousPasswordHash = credential.password');
    expect(membershipLockIndex).toBeGreaterThan(transactionIndex);
    expect(credentialClaimIndex).toBeGreaterThan(membershipLockIndex);
    expect(source).toContain('eq(account.password, previousPasswordHash)');
    expect(source).toContain('if (!rotatedCredential) throw new Error(PASSWORD_RESET_CONFLICT)');
  });

  it('keeps force-change profile state and audit evidence in the successful reset transaction', () => {
    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {');
    const profileIndex = source.indexOf('requiresPasswordChange: true', transactionIndex);
    const auditIndex = source.indexOf('await recordAuditEvent({', transactionIndex);
    expect(profileIndex).toBeGreaterThan(transactionIndex);
    expect(auditIndex).toBeGreaterThan(profileIndex);
    expect(source.slice(auditIndex)).toContain('}, tx);');
  });

  it('maps a stale membership or password claim to controlled 409', () => {
    expect(source).toContain('error.message === PASSWORD_RESET_CONFLICT');
    expect(source).toContain('This account or credential changed while the reset was being processed.');
    expect(source).toContain('{ status: 409 }');
  });
});
