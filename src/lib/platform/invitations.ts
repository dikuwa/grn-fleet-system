/**
 * Tenant invitation service.
 *
 * Creates secure, single-use, email-bound invitation tokens for Tenant
 * Administrators (and other roles). Supports resending, expiry, cancellation,
 * and acceptance that provisions a Better Auth user + tenant membership.
 */

import { getDb } from '@/db';
import { tenantInvitations, invitationRoles, type tenantInvitations as tenantInvitationsType } from '@/db/schema/invitations';
import { tenantMemberships } from '@/db/schema/tenants';
import { tenants } from '@/db/schema/tenants';
import { user, account } from '@/db/schema/better-auth';
import { eq, and, or, lt, gte, desc } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default invitation validity window. */
export const INVITATION_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/**
 * Generate a secure invitation token (cryptographically random, URL-safe).
 * The raw token is returned to the caller for the invite link; the DB stores
 * a SHA-256 hash so a leaked DB cannot mint valid links.
 */
export function generateInvitationToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Build the public accept URL for an invitation. */
export function invitationAcceptUrl(rawToken: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base}/accept-invite?token=${encodeURIComponent(rawToken)}`;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type InvitationWithDetails = tenantInvitationsType.$inferSelect & {
  tenantName: string;
};

/** Find a valid (non-expired, non-used) invitation by its raw token. */
export async function findInvitationByToken(rawToken: string): Promise<InvitationWithDetails | null> {
  const db = getDb();
  const hash = hashToken(rawToken);
  const now = new Date();

  const rows = await db
    .select({
      invitation: tenantInvitations,
      tenantName: tenants.name,
    })
    .from(tenantInvitations)
    .innerJoin(tenants, eq(tenantInvitations.tenantId, tenants.id))
    .where(
      and(
        eq(tenantInvitations.token, hash),
        or(
          eq(tenantInvitations.status, 'pending'),
          eq(tenantInvitations.status, 'sent'),
        ),
        gte(tenantInvitations.expiresAt, now),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;
  return { ...rows[0]!.invitation, tenantName: rows[0]!.tenantName };
}

/** List invitations for a tenant. */
export async function listInvitations(tenantId: string): Promise<InvitationWithDetails[]> {
  const db = getDb();
  const rows = await db
    .select({
      invitation: tenantInvitations,
      tenantName: tenants.name,
    })
    .from(tenantInvitations)
    .innerJoin(tenants, eq(tenantInvitations.tenantId, tenants.id))
    .where(eq(tenantInvitations.tenantId, tenantId))
    .orderBy(desc(tenantInvitations.createdAt));

  return rows.map((r) => ({ ...r.invitation, tenantName: r.tenantName }));
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type CreateInvitationInput = {
  tenantId: string;
  email: string;
  name?: string;
  type?: 'tenant_admin' | 'department_admin' | 'driver' | 'inspector' | 'custom';
  message?: string;
  roleIds?: string[];
  invitedByUserId: string;
  ttlDays?: number;
};

/**
 * Create an invitation and return its raw token (only exposed once).
 * Also marks the tenant lifecycle as awaiting invitation acceptance.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ invitation: InvitationWithDetails; rawToken: string }> {
  const db = getDb();
  const { raw, hash } = generateInvitationToken();
  const ttlDays = input.ttlDays ?? INVITATION_TTL_DAYS;

  const [invitation] = await db
    .insert(tenantInvitations)
    .values({
      tenantId: input.tenantId,
      email: input.email.trim().toLowerCase(),
      name: input.name,
      type: input.type ?? 'tenant_admin',
      message: input.message,
      token: hash,
      status: 'pending',
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      invitedByUserId: input.invitedByUserId,
      invitedByTenantId: input.invitedByUserId ? undefined : undefined,
    })
    .returning();

  // Assign requested roles
  if (input.roleIds && input.roleIds.length > 0) {
    await db.insert(invitationRoles).values(
      input.roleIds.map((roleId) => ({ invitationId: invitation.id, roleId })),
    );
  }

  const tenantName = await getTenantName(input.tenantId);
  return {
    invitation: { ...invitation, tenantName },
    rawToken: raw,
  };
}

async function getTenantName(tenantId: string): Promise<string> {
  const db = getDb();
  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant?.name ?? '';
}

// ---------------------------------------------------------------------------
// Mark sent / resend
// ---------------------------------------------------------------------------

/** Mark an invitation as sent. */
export async function markInvitationSent(invitationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(tenantInvitations)
    .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
    .where(eq(tenantInvitations.id, invitationId));
}

/** Resend an invitation — rotates the token, extends expiry. */
export async function resendInvitation(
  invitationId: string,
  ttlDays?: number,
): Promise<{ rawToken: string }> {
  const db = getDb();
  const { raw, hash } = generateInvitationToken();
  await db
    .update(tenantInvitations)
    .set({
      token: hash,
      status: 'sent',
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + (ttlDays ?? INVITATION_TTL_DAYS) * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(tenantInvitations.id, invitationId));
  return { rawToken: raw };
}

/** Cancel an invitation (no longer usable). */
export async function cancelInvitation(invitationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(tenantInvitations)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(tenantInvitations.id, invitationId));
}

/** Mark expired invitations past their expiry date. */
export async function expireStaleInvitations(): Promise<number> {
  const db = getDb();
  const now = new Date();
  const result = await db
    .update(tenantInvitations)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        or(eq(tenantInvitations.status, 'pending'), eq(tenantInvitations.status, 'sent')),
        lt(tenantInvitations.expiresAt, now),
      ),
    );
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

export type AcceptInvitationInput = {
  rawToken: string;
  name: string;
  email: string;
  password: string;
};

/**
 * Accept an invitation:
 *  - Validates token (exists, unexpired, matching email)
 *  - Creates a Better Auth user + password account (or links an existing user)
 *  - Creates an active tenant membership
 *  - Assigns the invitation's requested roles
 *  - Marks invitation accepted
 *  - Flips the tenant lifecycle to SETUP_IN_PROGRESS
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<{
  userId: string;
  tenantId: string;
  tenantName: string;
}> {
  const db = getDb();
  const invitation = await findInvitationByToken(input.rawToken);
  if (!invitation) {
    throw new Error('This invitation is invalid or has expired.');
  }
  if (invitation.email.toLowerCase() !== input.email.trim().toLowerCase()) {
    throw new Error('This invitation was issued to a different email address.');
  }

  const email = input.email.trim().toLowerCase();

  // Find or create the Better Auth user.
  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    // Update the display name if the invited name is provided and current is empty.
    if (!existingUser.name && input.name) {
      await db.update(user).set({ name: input.name, updatedAt: new Date() }).where(eq(user.id, userId));
    }
  } else {
    userId = `user-invite-${randomUUID().slice(0, 8)}`;
    await db.insert(user).values({
      id: userId,
      email,
      emailVerified: true,
      name: input.name,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();
  }

  // Set/update the password on the account record.
  const passwordHash = await bcrypt.hash(input.password, 10);
  const [existingAccount] = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'email')))
    .limit(1);

  if (existingAccount) {
    await db
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(account.id, existingAccount.id));
  } else {
    await db.insert(account).values({
      id: `acc-invite-${randomUUID().slice(0, 8)}`,
      accountId: email,
      providerId: 'email',
      userId,
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();
  }

  // Create the tenant membership.
  const [membership] = await db
    .insert(tenantMemberships)
    .values({
      tenantId: invitation.tenantId,
      userId,
      status: 'active',
    })
    .onConflictDoNothing()
    .returning();

  const membershipId =
    membership?.id ??
    (
      await db
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, invitation.tenantId),
            eq(tenantMemberships.userId, userId),
          ),
        )
        .limit(1)
    )[0]?.id;

  if (!membershipId) throw new Error('Could not establish tenant membership.');

  // Assign requested roles.
  const assignedRoles = await db
    .select()
    .from(invitationRoles)
    .where(eq(invitationRoles.invitationId, invitation.id));

  if (assignedRoles.length > 0) {
    const { roleAssignments } = await import('@/db/schema/tenants');
    const existing = await db
      .select({ id: roleAssignments.id, roleId: roleAssignments.roleId })
      .from(roleAssignments)
      .where(eq(roleAssignments.tenantMembershipId, membershipId));
    const existingRoleIds = new Set(existing.map((r) => r.roleId));
    const toInsert = assignedRoles
      .map((r) => ({ tenantMembershipId: membershipId, roleId: r.roleId }))
      .filter((r) => !existingRoleIds.has(r.roleId));
    if (toInsert.length > 0) {
      await db.insert(roleAssignments).values(toInsert);
    }
  }

  // Mark invitation accepted.
  await db
    .update(tenantInvitations)
    .set({ status: 'accepted', acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(tenantInvitations.id, invitation.id));

  // Flip tenant lifecycle to setup in progress.
  await db
    .update(tenants)
    .set({
      lifecycleStatus: 'SETUP_IN_PROGRESS',
      invitationAcceptedAt: new Date(),
      lifecycleChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, invitation.tenantId));

  return { userId, tenantId: invitation.tenantId, tenantName: invitation.tenantName };
}