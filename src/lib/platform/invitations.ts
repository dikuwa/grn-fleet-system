/**
 * Tenant invitation service.
 *
 * Creates secure, single-use, email-bound invitation tokens for Tenant
 * Administrators (and other roles). Supports resending, expiry, cancellation,
 * and atomic acceptance that provisions or reuses a Better Auth account.
 */

import { getDb } from '@/db';
import { tenantInvitations, invitationRoles } from '@/db/schema/invitations';
import { roleAssignments, tenantMemberships, tenants } from '@/db/schema/tenants';
import { user, account } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { eq, and, or, lt, gte, desc } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { getTenantEntitlements } from '@/lib/entitlements';
import { checkTenantUserCapacityLocked, lockTenantUserCapacity } from '@/lib/tenant-user-capacity';
import { lockUserMembershipInvariant } from '@/lib/user-membership-integrity';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default invitation validity window. */
export const INVITATION_TTL_DAYS = 7;

const ONBOARDING_INVITATION_LIFECYCLES = new Set([
  'DRAFT',
  'PENDING_INVITATION',
  'INVITATION_SENT',
  'INVITATION_EXPIRED',
]);

const CAPACITY_COUNTED_MEMBERSHIP_STATUSES = new Set([
  'active',
  'pending',
  'pending_activation',
  'suspended',
]);

export class InvitationCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationCapacityError';
  }
}

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

export type InvitationWithDetails = typeof tenantInvitations.$inferSelect & {
  tenantName: string;
};

export type InvitationAccountState = {
  existingUser: boolean;
  requiresPassword: boolean;
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

/**
 * Tell the invitation UI whether this email already has a local account.
 * Existing password credentials are never replaced during invitation acceptance.
 */
export async function getInvitationAccountState(email: string): Promise<InvitationAccountState> {
  const db = getDb();
  const normalisedEmail = email.trim().toLowerCase();
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalisedEmail))
    .limit(1);

  if (!existingUser) return { existingUser: false, requiresPassword: true };

  const [existingAccount] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, existingUser.id), eq(account.providerId, 'email')))
    .limit(1);

  return {
    existingUser: true,
    requiresPassword: !existingAccount?.password,
  };
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

/** Create an invitation and return its raw token (only exposed once). */
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
  password?: string;
};

/**
 * Only the first Tenant Administrator onboarding invitation may advance the
 * tenant into setup. Later staff/admin invitations must never regress an active
 * tenant back into onboarding.
 */
export function shouldStartTenantSetup(invitationType: string, lifecycleStatus: string): boolean {
  return invitationType === 'tenant_admin' && ONBOARDING_INVITATION_LIFECYCLES.has(lifecycleStatus);
}

export function isActiveInvitationIdentityProfile(profile: {
  status: string;
  accountEnabled: boolean;
} | null | undefined): boolean {
  return Boolean(profile?.accountEnabled && profile.status === 'active');
}

/**
 * Accept an invitation atomically:
 *  - Claims the single-use invitation inside the transaction
 *  - Reuses an existing account without changing its password
 *  - Rejects globally disabled identities instead of reactivating them indirectly
 *  - Ensures every accepted identity has a user_profiles security/lifecycle row
 *  - Creates a local password credential only when one is actually needed
 *  - Reuses an existing tenant membership and role assignments when present
 *  - Enforces tenant user capacity at the membership activation boundary
 *  - Serializes existing identity state with User Management and staff lifecycle
 *  - Advances lifecycle only for the first Tenant Administrator onboarding invite
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<{
  userId: string;
  tenantId: string;
  tenantName: string;
  existingUser: boolean;
}> {
  const db = getDb();
  const invitation = await findInvitationByToken(input.rawToken);
  if (!invitation) {
    throw new Error('This invitation is invalid or has expired.');
  }
  if (invitation.email.toLowerCase() !== input.email.trim().toLowerCase()) {
    throw new Error('This invitation was issued to a different email address.');
  }

  const entitlements = await getTenantEntitlements(invitation.tenantId);
  if (!entitlements) {
    throw new Error('Tenant not found.');
  }

  const email = input.email.trim().toLowerCase();
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
  const now = new Date();

  return db.transaction(async (tx) => {
    // Atomically claim the invitation. If another acceptance already won the
    // race, no row is returned. A later failure rolls this status update back.
    const [claimedInvitation] = await tx
      .update(tenantInvitations)
      .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
      .where(
        and(
          eq(tenantInvitations.id, invitation.id),
          or(eq(tenantInvitations.status, 'pending'), eq(tenantInvitations.status, 'sent')),
          gte(tenantInvitations.expiresAt, now),
        ),
      )
      .returning();

    if (!claimedInvitation) {
      throw new Error('This invitation has already been used or has expired.');
    }

    // Capacity is tenant-scoped and account/profile state is user-scoped. Keep
    // the same lock order used by staff restore: tenant capacity, then identity.
    await lockTenantUserCapacity(tx, invitation.tenantId);

    const [existingUser] = await tx
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
      await lockUserMembershipInvariant(tx, userId);

      const [existingProfile] = await tx
        .select({
          status: userProfiles.status,
          accountEnabled: userProfiles.accountEnabled,
        })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);

      if (existingProfile && !isActiveInvitationIdentityProfile(existingProfile)) {
        throw new Error(
          'This GRN Fleet identity is disabled and cannot accept a new organisation invitation until it is re-enabled.',
        );
      }
      if (!existingUser.name && input.name) {
        await tx.update(user).set({ name: input.name, updatedAt: now }).where(eq(user.id, userId));
      }
    } else {
      if (!passwordHash) {
        throw new Error('Create a password to finish setting up this new account.');
      }
      userId = `user-invite-${randomUUID().slice(0, 8)}`;
      await lockUserMembershipInvariant(tx, userId);
      await tx.insert(user).values({
        id: userId,
        email,
        emailVerified: true,
        name: input.name,
        createdAt: now,
        updatedAt: now,
      });
    }

    const [existingAccount] = await tx
      .select({ id: account.id, password: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'email')))
      .limit(1);

    if (!existingAccount?.password) {
      if (!passwordHash) {
        throw new Error('Create a password to finish setting up this account.');
      }
      if (existingAccount) {
        await tx
          .update(account)
          .set({ password: passwordHash, updatedAt: now })
          .where(eq(account.id, existingAccount.id));
      } else {
        await tx.insert(account).values({
          id: `acc-invite-${randomUUID().slice(0, 8)}`,
          accountId: email,
          providerId: 'email',
          userId,
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    // Existing password credentials are intentionally preserved.

    // A legacy Better Auth account may predate the GRN Fleet lifecycle profile.
    // Create only the missing extension row; never upsert over a disabled profile.
    await tx
      .insert(userProfiles)
      .values({
        id: userId,
        userId,
        displayName: existingUser?.name || input.name || email.split('@')[0],
        requiresPasswordChange: false,
        passwordStatus: 'permanent',
        status: 'active',
        accountEnabled: true,
      })
      .onConflictDoNothing({ target: userProfiles.userId });

    // Re-read after the conflict-safe insert while holding the identity lock so
    // User Management cannot disable the profile between validation and access.
    const [acceptedProfile] = await tx
      .select({
        status: userProfiles.status,
        accountEnabled: userProfiles.accountEnabled,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    if (!isActiveInvitationIdentityProfile(acceptedProfile)) {
      throw new Error(
        'This GRN Fleet identity is disabled and cannot accept a new organisation invitation until it is re-enabled.',
      );
    }

    const [existingMembership] = await tx
      .select({ id: tenantMemberships.id, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, invitation.tenantId),
          eq(tenantMemberships.userId, userId),
        ),
      )
      .limit(1);

    const consumesCapacity =
      !existingMembership || !CAPACITY_COUNTED_MEMBERSHIP_STATUSES.has(existingMembership.status);
    if (consumesCapacity) {
      const capacityCheck = await checkTenantUserCapacityLocked(
        tx,
        invitation.tenantId,
        entitlements,
        1,
      );
      if (!capacityCheck.ok) {
        throw new InvitationCapacityError(
          capacityCheck.message || 'User limit reached. Increase the tenant user allowance before accepting this invitation.',
        );
      }
    }

    let membershipId = existingMembership?.id;
    if (!membershipId) {
      const [membership] = await tx
        .insert(tenantMemberships)
        .values({
          tenantId: invitation.tenantId,
          userId,
          status: 'active',
        })
        .returning({ id: tenantMemberships.id });
      membershipId = membership?.id;
    } else if (existingMembership.status !== 'active') {
      const [activatedMembership] = await tx
        .update(tenantMemberships)
        .set({ status: 'active' })
        .where(
          and(
            eq(tenantMemberships.id, membershipId),
            eq(tenantMemberships.status, existingMembership.status),
          ),
        )
        .returning({ id: tenantMemberships.id });
      if (!activatedMembership) {
        throw new Error('This organisation membership changed while the invitation was being accepted. Please retry.');
      }
    }

    if (!membershipId) throw new Error('Could not establish tenant membership.');

    const assignedRoles = await tx
      .select({ roleId: invitationRoles.roleId })
      .from(invitationRoles)
      .where(eq(invitationRoles.invitationId, invitation.id));

    if (assignedRoles.length > 0) {
      const existing = await tx
        .select({ roleId: roleAssignments.roleId })
        .from(roleAssignments)
        .where(eq(roleAssignments.tenantMembershipId, membershipId));
      const existingRoleIds = new Set(existing.map((role) => role.roleId));
      const toInsert = assignedRoles
        .map((role) => ({ tenantMembershipId: membershipId, roleId: role.roleId }))
        .filter((role) => !existingRoleIds.has(role.roleId));
      if (toInsert.length > 0) {
        await tx.insert(roleAssignments).values(toInsert);
      }
    }

    const [tenant] = await tx
      .select({ lifecycleStatus: tenants.lifecycleStatus })
      .from(tenants)
      .where(eq(tenants.id, invitation.tenantId))
      .limit(1);

    if (!tenant) throw new Error('Tenant not found.');

    if (shouldStartTenantSetup(claimedInvitation.type, tenant.lifecycleStatus)) {
      await tx
        .update(tenants)
        .set({
          lifecycleStatus: 'SETUP_IN_PROGRESS',
          invitationAcceptedAt: now,
          lifecycleChangedAt: now,
          lifecycleReason: 'Tenant Administrator invitation accepted; initial setup can begin',
          updatedAt: now,
        })
        .where(eq(tenants.id, invitation.tenantId));
    }

    return {
      userId,
      tenantId: invitation.tenantId,
      tenantName: invitation.tenantName,
      existingUser: Boolean(existingUser),
    };
  });
}
