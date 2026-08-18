import { describe, expect, it } from 'vitest';
import { INVITATION_TTL_DAYS, invitationAcceptUrl, generateInvitationToken, hashToken } from './invitations';

describe('administrator invitation handoff', () => {
  it('uses a seven-day invitation lifetime', () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
  });

  it('never requires storing the raw token to validate its hash', () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();

    expect(first.raw).not.toBe(first.hash);
    expect(hashToken(first.raw)).toBe(first.hash);
    expect(first.raw).not.toBe(second.raw);
    expect(first.hash).not.toBe(second.hash);
  });

  it('builds the manual handoff URL from the one-time raw token', () => {
    const { raw } = generateInvitationToken();
    const url = invitationAcceptUrl(raw);

    expect(url).toContain('/accept-invite?token=');
    expect(url).toContain(encodeURIComponent(raw));
  });
});
