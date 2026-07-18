/**
 * Platform Tenant Onboarding API
 *
 * POST /api/platform/onboard  — Create everything needed for a new tenant
 *
 * Single-request provisioning that creates:
 * - Tenant record + default branding
 * - Default roles with system permissions
 * - Offices
 * - Departments
 * - Initial admin user (if auth is configured)
 *
 * Requires TENANT_MANAGE permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantBranding, tenantMemberships, roles, rolePermissions, roleAssignments, offices, departments } from '@/db/schema/tenants';
import { user, account } from '@/db/schema/better-auth';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions, RoleDefinitions } from '@/lib/permissions';
import { eq, or, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

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
  adminUser?: {
    email: string;
    password: string;
    name: string;
  };
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

    // Validate required fields
    if (!body.organisation?.name?.trim()) {
      return NextResponse.json({ error: 'Organisation name is required' }, { status: 400 });
    }
    if (!body.organisation?.code?.trim()) {
      return NextResponse.json({ error: 'Organisation code is required' }, { status: 400 });
    }
    if (!body.organisation?.slug?.trim()) {
      return NextResponse.json({ error: 'Organisation slug is required' }, { status: 400 });
    }

    if (body.adminUser && !body.adminUser.email?.trim()) {
      return NextResponse.json({ error: 'Admin email is required when creating an admin user' }, { status: 400 });
    }
    if (body.adminUser && !body.adminUser.password?.trim()) {
      return NextResponse.json({ error: 'Admin password is required when creating an admin user' }, { status: 400 });
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
    // Step 1: Create tenant
    // -----------------------------------------------------------------------

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: org.name.trim(),
        code: org.code.trim().toUpperCase(),
        slug: org.slug.trim().toLowerCase(),
        type: org.type || 'regional_council',
        status: 'active',
        timezone: org.timezone || 'Africa/Windhoek',
        locale: org.locale || 'en-NA',
      })
      .returning();

    // -----------------------------------------------------------------------
    // Step 2: Create branding
    // -----------------------------------------------------------------------

    const brandingValues: Record<string, unknown> = {
      tenantId: tenant.id,
      primaryColor: body.branding?.primaryColor || '#1F4E8C',
      accentColor: body.branding?.accentColor || '#0F766E',
    };
    if (body.branding?.contactEmail) brandingValues.contactEmail = body.branding.contactEmail;
    if (body.branding?.contactPhone) brandingValues.contactPhone = body.branding.contactPhone;
    if (body.branding?.address) brandingValues.address = body.branding.address;

    await db.insert(tenantBranding).values(brandingValues as any);

    // -----------------------------------------------------------------------
    // Step 3: Create offices
    // -----------------------------------------------------------------------

    const createdOffices: Array<{ id: string; code: string; name: string }> = [];
    if (body.offices && body.offices.length > 0) {
      // First pass: create all offices without parent
      for (const office of body.offices) {
        const [created] = await db
          .insert(offices)
          .values({
            tenantId: tenant.id,
            name: office.name,
            code: office.code,
            type: office.type,
            address: office.address || null,
          })
          .returning();
        createdOffices.push({ id: created.id, code: created.code, name: created.name });
      }

      // Second pass: update parent references
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
    // Step 4: Create departments
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
    // Step 5: Create default roles with permissions
    // -----------------------------------------------------------------------

    const roleNames = body.roles || [
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

      // Assign permissions
      if (roleDef.permissions.length > 0) {
        await db.insert(rolePermissions).values(
          roleDef.permissions.map((permCode: string) => ({
            roleId: role.id,
            permissionCode: permCode,
          })),
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: Create admin user (optional)
    // -----------------------------------------------------------------------

    let createdUser: { id: string; email: string } | null = null;

    if (body.adminUser) {
      const passwordHash = await bcrypt.hash(body.adminUser.password, 10);
      const userId = `user-onboard-${crypto.randomUUID().slice(0, 8)}`;

      await db.insert(user).values({
        id: userId,
        email: body.adminUser.email.trim().toLowerCase(),
        emailVerified: true,
        name: body.adminUser.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing();

      await db.insert(account).values({
        id: `acc-onboard-${crypto.randomUUID().slice(0, 8)}`,
        accountId: body.adminUser.email.trim().toLowerCase(),
        providerId: 'email',
        userId,
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing();

      // Create tenant membership
      await db.insert(tenantMemberships).values({
        tenantId: tenant.id,
        userId,
        status: 'active',
      }).onConflictDoNothing();

      // Assign TRANSPORT_ADMIN role to the admin user
      const membership = await db
        .select()
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, tenant.id),
            eq(tenantMemberships.userId, userId),
          ),
        )
        .limit(1);

      if (membership.length > 0) {
        const adminRole = createdRoles.find((r) => r.name === RoleDefinitions.TRANSPORT_ADMIN.name);
        if (adminRole) {
          // Only assign, let the permissions engine check timing
          const [existingAssignment] = await db
            .select()
            .from(roleAssignments)
            .where(
              and(
                eq(roleAssignments.tenantMembershipId, membership[0].id),
                eq(roleAssignments.roleId, adminRole.id),
              ),
            )
            .limit(1);

          if (!existingAssignment) {
            await db.insert(roleAssignments).values({
              tenantMembershipId: membership[0].id,
              roleId: adminRole.id,
            });
          }
        }
      }

      createdUser = { id: userId, email: body.adminUser.email.trim().toLowerCase() };
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          tenant,
          branding: brandingValues,
          offices: createdOffices,
          departments: createdDepts,
          roles: createdRoles,
          adminUser: createdUser,
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
