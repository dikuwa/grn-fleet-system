import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/tenants/[id]/admin-invitation/route.ts'),
  'utf8',
);

describe('tenant administrator invitation lifecycle compare-and-set', () => {
  it('claims the previously reviewed invitation status before regeneration', () => {
    const rotation = source.indexOf('const [rotatedInvitation] = await db');
    const idClaim = source.indexOf('eq(tenantInvitations.id, result.invitation.id)', rotation);
    const statusClaim = source.indexOf('eq(tenantInvitations.status, result.invitation.status)', idClaim);
    const returning = source.indexOf('.returning({ id: tenantInvitations.id })', statusClaim);

    expect(rotation).toBeGreaterThan(-1);
    expect(idClaim).toBeGreaterThan(rotation);
    expect(statusClaim).toBeGreaterThan(idClaim);
    expect(returning).toBeGreaterThan(statusClaim);
    expect(source).toContain('if (!rotatedInvitation) throw new Error(INVITATION_LIFECYCLE_CONFLICT)');
  });

  it('marks sent only for the exact rotated token that is still pending', () => {
    const markedSent = source.indexOf('const [markedSent] = await db');
    const tokenClaim = source.indexOf('eq(tenantInvitations.token, hash)', markedSent);
    const pendingClaim = source.indexOf("eq(tenantInvitations.status, 'pending')", tokenClaim);
    const returning = source.indexOf('.returning({ id: tenantInvitations.id })', pendingClaim);

    expect(markedSent).toBeGreaterThan(-1);
    expect(tokenClaim).toBeGreaterThan(markedSent);
    expect(pendingClaim).toBeGreaterThan(tokenClaim);
    expect(returning).toBeGreaterThan(pendingClaim);
    expect(source).toContain('if (!markedSent) throw new Error(INVITATION_LIFECYCLE_CONFLICT)');
  });

  it('maps a lost lifecycle claim to a controlled 409', () => {
    expect(source).toContain("const INVITATION_LIFECYCLE_CONFLICT = 'invitation_lifecycle_conflict'");
    expect(source).toContain('error.message === INVITATION_LIFECYCLE_CONFLICT');
    expect(source).toContain('{ status: 409 }');
  });
});
