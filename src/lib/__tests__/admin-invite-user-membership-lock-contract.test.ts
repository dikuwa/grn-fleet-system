import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/invites/route.ts'),
  'utf8',
);

describe('admin invitation shared user membership lock', () => {
  it('serializes revoke and resend with User Management before row-level claims', () => {
    const revoke = source.indexOf("if (action === 'revoke')");
    const revokeTransaction = source.indexOf('await db.transaction(async (tx) => {', revoke);
    const revokeAdvisory = source.indexOf('lockUserMembershipInvariant(tx, userId)', revokeTransaction);
    const revokeRowLock = source.indexOf(".for('update')", revokeAdvisory);

    const resend = source.indexOf('const previousPasswordHash = credentialAccount.password');
    const resendTransaction = source.indexOf('await db.transaction(async (tx) => {', resend);
    const resendAdvisory = source.indexOf('lockUserMembershipInvariant(tx, userId)', resendTransaction);
    const resendRowLock = source.indexOf(".for('update')", resendAdvisory);

    expect(revokeAdvisory).toBeGreaterThan(revokeTransaction);
    expect(revokeRowLock).toBeGreaterThan(revokeAdvisory);
    expect(resendAdvisory).toBeGreaterThan(resendTransaction);
    expect(resendRowLock).toBeGreaterThan(resendAdvisory);
  });
});
