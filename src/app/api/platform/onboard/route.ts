/**
 * Platform Tenant Onboarding API
 *
 * POST /api/platform/onboard — Create a new tenant through the 7-step
 * Platform Administrator onboarding wizard.
 *
 * Creates:
 * - Tenant record (lifecycle DRAFT → PENDING_INVITATION) with primary contact
 * - Default roles with system permissions
 * - Offices (optional)
 * - Departments (optional)
 * - Subscription record (package + billing interval)
 * - Branding (optional)
 * - A secure Tenant Administrator invitation (email delivered)
 *
 * Requires TENANT_MANAGE / PLATFORM_ADMIN permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantBranding, roles, rolePermissions } from '@/db/schema/tenants';
import { offices, departments } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions, RoleDefinitions } from '@/lib/permissions';
import { eq, or } from 'drizzle-orm';
import { createSubscription } from '@/lib/platform/subscriptions';
import { createInvitation, invitationAcceptUrl } from '@/lib/platform/invitations';
import { recordAuditEvent } from '@/lib/audit-event';
import { sendInvitationEmail } from '@/lib/platform/email-templates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingRequest {
  organisation: {
    name: string;
    code: string;
    slug: string;
    type?: string;
    timezone?: string;
    locale?: string;
  };
  primaryContact: {
    name: string;
    email: string;
    phone?: string;
    title?: string;
  };
  tenantAdmin: {
    email: string;
    name: string;
  };
  subscription: {
    packageId: string;
    billingInterval: 'monthly' | 'quarterly' | 'annually';
    trialDays?: number;
    gracePeriodDays?: number;
  };
  branding?: {
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
    primaryColor?: string;
    accentColor?: string;
  };
  offices?: Array<{
    name: string;
    code: string;
    type: string;
    address?: string;
    parentCode?: string;
  }>;
  departments?: Array<{
    name: string;
    code: string;
  }>;
  roles?: string[]; // Role names to create (from RoleDefinitions keys)
}

// ---------------------------------------------------------------------------
// POST — Onboard a new tenant
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body: OnboardingRequest = await request.json();

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    if (!body.organisation?.name?.trim()) {
      return NextResponse.json({ error: 'Organisation name is required' }, { status: 400 });
    }
    if (!body.organisation?.code?.trim()) {
      return NextResponse.json({ error: 'Organisation code is required' }, { status: 400 });
    }
    if (!body.organisation?.slug?.trim()) {
      return NextResponse.json({ error: 'Organisation slug is required' }, { status: 400 });
    }
    if (!body.primaryContact?.email?.trim() || !body.primaryContact?.name?.trim()) {
      return NextResponse.json(
        { error: 'Primary contact name and email are required' },
        { status: 400 },
      );
    }
    if (!body.tenantAdmin?.email?.trim() || !body.tenantAdmin?.name?.trim()) {
      return NextResponse.json(
        { error: 'Tenant Administrator name and email are required' },
        { status: 400 },
      );
    }
    if (!body.subscription?.packageId) {
      return NextResponse.json({ error: 'A subscription package is required' }, { status: 400 });
    }

    const db = getDb();
    const org = body.organisation;

    // Check for duplicate slug or code
    const [existing] = await db
      .select()
      .from(tenants)
      .where(
        or(
          eq(tenants.slug, org.slug.trim().toLowerCase()),
          eq(tenants.code, org.code.trim().toUpperCase()),
        )!,
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `A tenant with code "${org.code}" or slug "${org.slug}" already exists` },
        { status: 409 },
      );
    }

    // -----------------------------------------------------------------------
    // Step 1: Create tenant (DRAFT lifecycle)
    // -----------------------------------------------------------------------

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: org.name.trim(),
        code: org.code.trim().toUpperCase(),
        slug: org.slug.trim().toLowerCase(),
        type: org.type || 'regional_council',
        status: 'ACTIVE',
        lifecycleStatus: 'PENDING_INVITATION',
        createdByUserId: session.user.id,
        primaryContactName: body.primaryContact.name.trim(),
        primaryContactEmail: body.primaryContact.email.trim().toLowerCase(),
        primaryContactPhone: body.primaryContact.phone,
        lifecycleChangedAt: new Date(),
        timezone: org.timezone || 'Africa/Windhoek',
        locale: org.locale || 'en-NA',
      })
      .returning();

    // -----------------------------------------------------------------------
    // Step 2: Create subscription
    // -----------------------------------------------------------------------

    let subscription;
    try {
      subscription = await createSubscription({
        tenantId: tenant.id,
        packageId: body.subscription.packageId,
        billingInterval: body.subscription.billingInterval,
        trialDays: body.subscription.trialDays,
        gracePeriodDays: body.subscription.gracePeriodDays,
      });
    } catch (subError) {
      // Roll back tenant creation on subscription failure.
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
      return NextResponse.json(
        { error: 'Failed to create subscription: ' + String(subError) },
        { status: 400 },
      );
    }

    // -----------------------------------------------------------------------
    // Step 3: Create branding (optional)
    // -----------------------------------------------------------------------

    if (body.branding && (body.branding.contactEmail || body.branding.address || body.branding.primaryColor)) {
      await db.insert(tenantBranding).values({
        tenantId: tenant.id,
        primaryColor: body.branding.primaryColor || '#1F4E8C',
        accentColor: body.branding.accentColor || '#0F766E',
        contactEmail: body.branding.contactEmail || undefined,
        contactPhone: body.branding.contactPhone || undefined,
        address: body.branding.address || undefined,
      });
    }

    // -----------------------------------------------------------------------
    // Step 4: Create offices
    // -----------------------------------------------------------------------

    const createdOffices: Array<{ id: string; code: string | null; name: string }> = [];
    if (body.offices && body.offices.length > 0) {
      for (const office of body.offices) {
        const [created] = await db
          .insert(offices)
          .values({
            tenantId: tenant.id,
            name: office.name,
            code: office.code,
            type: office.type,
            address: office.address || undefined,
          })
          .returning();
        createdOffices.push({ id: created.id, code: created.code, name: created.name });
      }
      // Second pass: resolve parent references.
      for (let i = 0; i < body.offices.length; i++) {
        const officeBody = body.offices[i];
        const createdOffice = createdOffices[i];
        if (officeBody.parentCode) {
          const parent = createdOffices.find((o) => o.code === officeBody.parentCode);
          if (parent) {
            await db
              .update(offices)
              .set({ parentId: parent.id })
              .where(eq(offices.id, createdOffice.id));
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Create departments
    // -----------------------------------------------------------------------

    const createdDepts: Array<{ id: string; name: string }> = [];
    if (body.departments && body.departments.length > 0) {
      for (const dept of body.departments) {
        const [created] = await db
          .insert(departments)
          .values({
            tenantId: tenant.id,
            name: dept.name,
            code: dept.code,
          })
          .returning();
        createdDepts.push({ id: created.id, name: created.name });
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Create default roles with permissions
    // -----------------------------------------------------------------------

    const roleNames = body.roles || [
      'TENANT_ADMIN',
      'TRANSPORT_ADMIN',
      'REQUESTER',
      'SUPERVISOR',
      'CONTROL_ADMIN_OFFICER',
      'DEPUTY_DIRECTOR',
      'DIRECTOR',
      'CHIEF_REGIONAL_OFFICER',
      'DRIVER',
      'TENANT_AUDITOR',
    ];

    const createdRoles: Array<{ id: string; name: string }> = [];
    for (const roleKey of roleNames) {
      const roleDef = RoleDefinitions[roleKey as keyof typeof RoleDefinitions];
      if (!roleDef) continue;

      const [role] = await db
        .insert(roles)
        .values({
          tenantId: tenant.id,
          name: roleDef.name,
          isSystem: true,
        })
        .returning();

      createdRoles.push({ id: role.id, name: roleDef.name });

      if (roleDef.permissions.length > 0) {
        await db.insert(rolePermissions).values(
          roleDef.permissions.map((permCode: string) => ({
            roleId: role.id,
            permissionCode: permCode,
          })),
        );
      }
    }

    // Assign TENANT_ADMIN role to the invitation.
    const tenantAdminRole = createdRoles.find(
      (r) => r.name === RoleDefinitions.TENANT_ADMIN.name,
    );
    const adminRoleIds = tenantAdminRole ? [tenantAdminRole.id] : [];

    // -----------------------------------------------------------------------
    // Step 7: Create + send the Tenant Administrator invitation
    // -----------------------------------------------------------------------

    const { invitation, rawToken } = await createInvitation({
      tenantId: tenant.id,
      email: body.tenantAdmin.email.trim(),
      name: body.tenantAdmin.name.trim(),
      type: 'tenant_admin',
      invitedByUserId: session.user.id,
      roleIds: adminRoleIds,
    });

    const acceptUrl = invitationAcceptUrl(rawToken);

    // Attempt to send the invitation email; failure does not fail the onboard.
    let emailSent = false;
    try {
      await sendInvitationEmail({
        to: invitation.email,
        tenantName: tenant.name,
        inviteeName: body.tenantAdmin.name.trim(),
        invitedByName: session.user.name ?? 'Platform Administrator',
        acceptUrl,
        expiresAt: invitation.expiresAt,
      });
      emailSent = true;
    } catch (emailError) {
      console.error('[Onboard] Invitation email failed:', emailError);
    }

    // -----------------------------------------------------------------------
    // Step 8: Audit trail
    // -----------------------------------------------------------------------

    await recordAuditEvent({
      tenantId: tenant.id,
      actorUserId: session.user.id,
      eventType: 'tenant_onboarded',
      action: 'CREATE',
      entityType: 'tenant',
      entityId: tenant.id,
      summary: `Lifecycle: PENDING_INVITATION, package: ${subscription.packageCode}, email sent: ${emailSent}`,
    }).catch(() => {});

    return NextResponse.json(
      {
        success: true,
        data: {
          tenant,
          subscription,
          branding: body.branding,
          offices: createdOffices,
          departments: createdDepts,
          roles: createdRoles,
          invitation: { id: invitation.id, email: invitation.email, sent: emailSent },
          acceptUrl,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[Onboarding] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to onboard tenant: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — onboarding prerequisites (packages available for selection)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const { listPackages } = await import('@/lib/platform/packages');
    const packages = await listPackages();
    return NextResponse.json({
      success: true,
      data: {
        packages: packages.filter((p) => p.status === 'active'),
      },
    });
  } catch (error) {
    console.error('[Onboarding] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}