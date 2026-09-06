import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/invites/route.ts'),
  'utf8',
);

describe('admin invitation action serialization', () => {
  it('uses the shared user-membership advisory lock before revoke row claims', () => {
    const revokeIndex = source.indexOf("if (action === 'revoke')");
    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {', revokeIndex);
    const advisoryLockIndex = source.indexOf('lockUserMembershipInvariant(tx, userId)', transactionIndex);
    const userRowLockIndex = source.indexOf(".for('update')", advisoryLockIndex);
    const membershipClaimIndex = source.indexOf('const [revokedMembership] = await tx', userRowLockIndex);

    expect(source).toContain("import { lockUserMembershipInvariant } from '@/lib/user-membership-integrity'");
    expect(advisoryLockIndex).toBeGreaterThan(transactionIndex);
    expect(userRowLockIndex).toBeGreaterThan(advisoryLockIndex);
    expect(membershipClaimIndex).toBeGreaterThan(userRowLockIndex);
  });

  it('claims a still-unverified active invitation before revoking and audits in the same transaction', () => {
    const revokeIndex = source.indexOf("if (action === 'revoke')");
    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {', revokeIndex);
    const userLockIndex = source.indexOf(".for('update')", transactionIndex);
    const membershipClaimIndex = source.indexOf('const [revokedMembership] = await tx', transactionIndex);
    const auditIndex = source.indexOf("action: 'user_invitation.revoked'", transactionIndex);

    expect(source).toContain("const INVITATION_STATE_CONFLICT = 'invitation_state_conflict'");
    expect(source).toContain('if (!lockedUser || lockedUser.emailVerified)');
    expect(source).toContain("eq(tenantMemberships.status, 'active')");
    expect(source).toContain('if (!revokedMembership) throw new Error(INVITATION_STATE_CONFLICT)');
    expect(userLockIndex).toBeGreaterThan(transactionIndex);
    expect(membershipClaimIndex).toBeGreaterThan(userLockIndex);
    expect(auditIndex).toBeGreaterThan(membershipClaimIndex);
    expect(source.slice(auditIndex)).toContain('}, tx);');
  });

  it('uses the shared user-membership advisory lock before resend state and credential claims', () => {
    const resendCredential = source.indexOf('const previousPasswordHash = credentialAccount.password');
    const transactionIndex = source.indexOf('await db.transaction(async (tx) => {', resendCredential);
    const advisoryLockIndex = source.indexOf('lockUserMembershipInvariant(tx, userId)', transactionIndex);
    const userRowLockIndex = source.indexOf(".for('update')", advisoryLockIndex);
    const membershipRowLockIndex = source.indexOf(".for('update')", userRowLockIndex + 1);
    const credentialClaimIndex = source.indexOf('const [rotatedCredential] = await tx', membershipRowLockIndex);

    expect(advisoryLockIndex).toBeGreaterThan(transactionIndex);
    expect(userRowLockIndex).toBeGreaterThan(advisoryLockIndex);
    expect(membershipRowLockIndex).toBeGreaterThan(userRowLockIndex);
    expect(credentialClaimIndex).toBeGreaterThan(membershipRowLockIndex);
  });

  it('claims the exact previous password before rotating a resend credential', () => {
    expect(source).toContain("const INVITATION_CREDENTIAL_CONFLICT = 'invitation_credential_conflict'");
    expect(source).toContain('eq(account.password, previousPasswordHash)');
    expect(source).toContain('.returning({ id: account.id })');
    expect(source).toContain('if (!rotatedCredential) throw new Error(INVITATION_CREDENTIAL_CONFLICT)');
    expect(source).toContain("action: 'user_invitation.credential_rotated'");
    expect(source).toContain('deliveryPending: true');
  });

  it('does not let a stale delivery failure overwrite a newer credential', () => {
    expect(source).toContain('eq(account.password, passwordHash)');
    expect(source).toContain('temporaryCredentialRestored: Boolean(restoredCredential)');
    expect(source).toContain('newerCredentialPreserved: !restoredCredential');
  });

  it('maps lost invitation or credential claims to controlled 409', () => {
    expect(source).toContain('error.message === INVITATION_STATE_CONFLICT');
    expect(source).toContain('error.message === INVITATION_CREDENTIAL_CONFLICT');
    expect(source).toContain('{ status: 409 }');
  });
});
