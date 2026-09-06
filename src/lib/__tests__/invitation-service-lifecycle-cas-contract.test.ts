import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/platform/invitations.ts'),
  'utf8',
);

describe('shared invitation lifecycle compare-and-set', () => {
  it('marks sent only from the exact pending token snapshot', () => {
    const fn = source.indexOf('export async function markInvitationSent');
    const tokenClaim = source.indexOf('eq(tenantInvitations.token, snapshot.token)', fn);
    const statusClaim = source.indexOf('eq(tenantInvitations.status, snapshot.status)', tokenClaim);
    const returning = source.indexOf('.returning({ id: tenantInvitations.id })', statusClaim);

    expect(fn).toBeGreaterThan(-1);
    expect(source.slice(fn, tokenClaim)).toContain("snapshot.status !== 'pending'");
    expect(tokenClaim).toBeGreaterThan(fn);
    expect(statusClaim).toBeGreaterThan(tokenClaim);
    expect(returning).toBeGreaterThan(statusClaim);
  });

  it('resends only live or expired states and claims the exact previous token and status', () => {
    const fn = source.indexOf('export async function resendInvitation');
    const allowed = source.indexOf("['pending', 'sent', 'expired'].includes(snapshot.status)", fn);
    const tokenClaim = source.indexOf('eq(tenantInvitations.token, snapshot.token)', allowed);
    const statusClaim = source.indexOf('eq(tenantInvitations.status, snapshot.status)', tokenClaim);
    const returning = source.indexOf('.returning({ id: tenantInvitations.id })', statusClaim);

    expect(fn).toBeGreaterThan(-1);
    expect(allowed).toBeGreaterThan(fn);
    expect(tokenClaim).toBeGreaterThan(allowed);
    expect(statusClaim).toBeGreaterThan(tokenClaim);
    expect(returning).toBeGreaterThan(statusClaim);
  });

  it('keeps accepted invitations out of cancellation and uses an exact snapshot claim', () => {
    const fn = source.indexOf('export async function cancelInvitation');
    const allowed = source.indexOf("['pending', 'sent', 'expired'].includes(snapshot.status)", fn);
    const tokenClaim = source.indexOf('eq(tenantInvitations.token, snapshot.token)', allowed);
    const statusClaim = source.indexOf('eq(tenantInvitations.status, snapshot.status)', tokenClaim);

    expect(fn).toBeGreaterThan(-1);
    expect(source.slice(fn, allowed)).toContain("snapshot.status === 'cancelled'");
    expect(allowed).toBeGreaterThan(fn);
    expect(tokenClaim).toBeGreaterThan(allowed);
    expect(statusClaim).toBeGreaterThan(tokenClaim);
  });

  it('uses an explicit lifecycle conflict error for lost claims', () => {
    expect(source).toContain('export class InvitationLifecycleConflictError extends Error');
    expect(source).toContain("this.name = 'InvitationLifecycleConflictError'");
  });
});
