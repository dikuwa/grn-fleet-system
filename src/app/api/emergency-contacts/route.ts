/**
 * Emergency Contacts API
 *
 * GET  /api/emergency-contacts — List emergency contacts for the session tenant
 *       Optional query params: region, role, includeInactive
 *       Platform admins may override tenant via `tenantId` query param.
 * POST /api/emergency-contacts — Upsert an emergency contact (requires EMERGENCY_CONTACTS_MANAGE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  listEmergencyContacts,
  upsertEmergencyContact,
  isEmergencyContactRole,
} from '@/lib/incidents/emergency-contacts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveTenantId(sessionTenantId: string, tenantOverride: string | null, isPlatformAdmin: boolean): string {
  if (tenantOverride && isPlatformAdmin) return tenantOverride;
  return sessionTenantId;
}

function invalidPlatformTenantOverride(tenantOverride: string | null, isPlatformAdmin: boolean) {
  return Boolean(tenantOverride && isPlatformAdmin && !UUID_PATTERN.test(tenantOverride));
}

// ---------------------------------------------------------------------------
// GET — List contacts for the session tenant
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { searchParams } = new URL(req.url);
    const region = searchParams.get('region');
    const role = searchParams.get('role');
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const tenantOverride = searchParams.get('tenantId');

    // Determine if the user is a platform admin (for tenant override)
    const isPlatformAdmin = (
      await import('@/lib/auth-helpers').then((m) => m.hasPermission(session, Permissions.PLATFORM_ADMIN))
    );
    if (invalidPlatformTenantOverride(tenantOverride, isPlatformAdmin)) {
      return NextResponse.json({ error: 'tenantId must be a valid UUID' }, { status: 400 });
    }

    const tenantId = resolveTenantId(session.tenantId, tenantOverride, isPlatformAdmin);

    const rows = await listEmergencyContacts(tenantId, {
      includeInactive,
      region: region || undefined,
      role: role || undefined,
    });

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[emergency-contacts] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch emergency contacts' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Upsert an emergency contact
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.EMERGENCY_CONTACTS_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const { name, phone, role, region, sortOrder, isActive, tenantId: tenantOverrideValue } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!phone?.trim()) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }
    if (!role?.trim()) {
      return NextResponse.json({ error: 'Role is required' }, { status: 400 });
    }
    if (!isEmergencyContactRole(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: hospital, police, towing, fire, insurance, internal` },
        { status: 400 },
      );
    }

    // Determine tenant: allow platform admins to target a specific tenant
    const isPlatformAdmin = (
      await import('@/lib/auth-helpers').then((m) => m.hasPermission(session, Permissions.PLATFORM_ADMIN))
    );
    const tenantOverride = typeof tenantOverrideValue === 'string' ? tenantOverrideValue : null;
    if (invalidPlatformTenantOverride(tenantOverride, isPlatformAdmin)) {
      return NextResponse.json({ error: 'tenantId must be a valid UUID' }, { status: 400 });
    }
    const tenantId = resolveTenantId(session.tenantId, tenantOverride, isPlatformAdmin);

    const row = await upsertEmergencyContact(
      tenantId,
      {
        name: name.trim(),
        phone: phone.trim(),
        role,
        region: region?.trim() || null,
        sortOrder: sortOrder != null ? Number(sortOrder) : undefined,
        isActive: isActive !== false,
      },
      session.user.id,
    );

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    console.error('[emergency-contacts] POST failed:', error);
    return NextResponse.json({ error: 'Failed to save emergency contact' }, { status: 500 });
  }
}
