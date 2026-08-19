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
 * - A secure Tenant Administrator invitation (email delivered when configured)
 * - Universal operational defaults (incident categories + inspection templates)
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
import { seedTenantOperationalDefaults } from '@/lib/platform/tenant-operational-defaults';
import { cleanupFailedTenantOnboarding } from '@/lib/platform/onboarding-cleanup';
import { writePublicEmployeeRequestConfig } from '@/lib/public-request-access';

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
  roles?: string[];
}

type OnboardingBootstrapResult = {
  tenant: typeof tenants.$inferSelect;
  subscription: Awaited<ReturnType<typeof createSubscription>>;
  createdOffices: Array<{ id: string; code: string | null; name: string }>;
  createdDepts: Array<{ id: string; name: string }>;
  createdRoles: Array<{ id: string; name: string }>;
  invitation: Awaited<ReturnType<typeof createInvitation>>['invitation'];
  rawToken: string;
  operationalDefaults: Awaited<ReturnType<typeof seedTenantOperationalDefaults>>;
};

class SubscriptionSetupError extends Error {
  constructor(cause: unknown) {
    super(`Failed to create subscription: ${String(cause)}`);
    this.name = 'SubscriptionSetupError';
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body: OnboardingRequest = await request.json();

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

    let createdTenantId: string | null = null;
    let bootstrap: OnboardingBootstrapResult;

    try {
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
          metadata: writePublicEmployeeRequestConfig({}, false),
        })
        .returning();
      createdTenantId = tenant.id;

      let subscription: Awaited<ReturnType<typeof createSubscription>>;
      try {
        subscription = await createSubscription({
          tenantId: tenant.id,
          packageId: body.subscription.packageId,
          billingInterval: body.subscription.billingInterval,
          trialDays: body.subscription.trialDays,
          gracePeriodDays: body.subscription.gracePeriodDays,
        });
      } catch (subError) {
        throw new SubscriptionSetupError(subError);
      }

      if (
        body.branding &&
        (body.branding.contactEmail || body.branding.address || body.branding.primaryColor)
      ) {
        await db.insert(tenantBranding).values({
          tenantId: tenant.id,
          primaryColor: body.branding.primaryColor || '#1F4E8C',
          accentColor: body.branding.accentColor || '#0F766E',
          contactEmail: body.branding.contactEmail || undefined,
          contactPhone: body.branding.contactPhone || undefined,
          address: body.branding.address || undefined,
        });
      }

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

        for (let i = 0; i < body.offices.length; i++) {
          const officeBody = body.offices[i];
          const createdOffice = createdOffices[i];
          if (officeBody.parentCode) {
            const parent = createdOffices.find((office) => office.code === officeBody.parentCode);
            if (parent) {
              await db
                .update(offices)
                .set({ parentId: parent.id })
                .where(eq(offices.id, createdOffice.id));
            }
          }
        }
      }

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

      const tenantAdminRole = createdRoles.find(
        (role) => role.name === RoleDefinitions.TENANT_ADMIN.name,
      );
      const adminRoleIds = tenantAdminRole ? [tenantAdminRole.id] : [];

      const { invitation, rawToken } = await createInvitation({
        tenantId: tenant.id,
        email: body.tenantAdmin.email.trim(),
        name: body.tenantAdmin.name.trim(),
        type: 'tenant_admin',
        invitedByUserId: session.user.id,
        roleIds: adminRoleIds,
      });

      // Universal defaults are part of the database/bootstrap boundary. They
      // must succeed before an invitation email can leave the system.
      const operationalDefaults = await seedTenantOperationalDefaults({
        tenantId: tenant.id,
        actorUserId: session.user.id,
      });

      bootstrap = {
        tenant,
        subscription,
        createdOffices,
        createdDepts,
        createdRoles,
        invitation,
        rawToken,
        operationalDefaults,
      };
    } catch (bootstrapError) {
      if (createdTenantId) {
        try {
          await cleanupFailedTenantOnboarding(createdTenantId);
        } catch (cleanupError) {
          console.error('[Onboard] Failed to compensate incomplete tenant onboarding:', {
            tenantId: createdTenantId,
            bootstrapError,
            cleanupError,
          });
          return NextResponse.json(
            {
              error:
                'Tenant onboarding failed and automatic cleanup could not complete. Platform support must review the incomplete tenant before retrying.',
            },
            { status: 500 },
          );
        }
      }

      if (bootstrapError instanceof SubscriptionSetupError) {
        return NextResponse.json({ error: bootstrapError.message }, { status: 400 });
      }

      throw bootstrapError;
    }

    const acceptUrl = invitationAcceptUrl(bootstrap.rawToken);

    // Email is intentionally outside the bootstrap/compensation boundary. A
    // provider outage must never destroy a valid tenant that was fully created.
    let emailSent = false;
    try {
      await sendInvitationEmail({
        to: bootstrap.invitation.email,
        tenantName: bootstrap.tenant.name,
        inviteeName: body.tenantAdmin.name.trim(),
        invitedByName: session.user.name ?? 'Platform Administrator',
        acceptUrl,
        expiresAt: bootstrap.invitation.expiresAt,
      });
      emailSent = true;
    } catch (emailError) {
      console.error('[Onboard] Invitation email failed:', emailError);
    }

    await recordAuditEvent({
      tenantId: bootstrap.tenant.id,
      actorUserId: session.user.id,
      eventType: 'tenant_onboarded',
      action: 'CREATE',
      entityType: 'tenant',
      entityId: bootstrap.tenant.id,
      summary: `Lifecycle: PENDING_INVITATION, package: ${bootstrap.subscription.packageCode}, email sent: ${emailSent}, inspection defaults ready: ${bootstrap.operationalDefaults.inspectionsReady}`,
    }).catch(() => {});

    return NextResponse.json(
      {
        success: true,
        data: {
          tenant: bootstrap.tenant,
          subscription: bootstrap.subscription,
          branding: body.branding,
          offices: bootstrap.createdOffices,
          departments: bootstrap.createdDepts,
          roles: bootstrap.createdRoles,
          operationalDefaults: bootstrap.operationalDefaults,
          invitation: {
            id: bootstrap.invitation.id,
            email: bootstrap.invitation.email,
            sent: emailSent,
          },
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
