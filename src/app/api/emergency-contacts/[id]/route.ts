/**
 * Emergency Contact detail API
 *
 * PATCH /api/emergency-contacts/[id] — Update contact fields or active status
 * DELETE /api/emergency-contacts/[id] — Delete an emergency contact
 *
 * Platform admins may target another tenant via `tenantId`; normal tenant
 * users remain locked to their session tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  hasPermission,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  deleteEmergencyContact,
  EMERGENCY_CONTACT_EDIT_CONFLICT,
  isEmergencyContactRole,
  setEmergencyContactActive,
  updateEmergencyContact,
} from '@/lib/incidents/emergency-contacts';

function resolveTenantId(
  sessionTenantId: string,
  tenantOverride: string | null | undefined,
  isPlatformAdmin: boolean,
) {
  return tenantOverride && isPlatformAdmin ? tenantOverride : sessionTenantId;
}

function databaseCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof value.code === 'string'
    ? value.code
    : typeof value.cause?.code === 'string'
      ? value.cause.code
      : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.EMERGENCY_CONTACTS_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await req.json();
    const isPlatformAdmin = await hasPermission(session, Permissions.PLATFORM_ADMIN);
    const tenantId = resolveTenantId(
      session.tenantId,
      typeof body.tenantId === 'string' ? body.tenantId : null,
      isPlatformAdmin,
    );

    const hasContactFields = ['name', 'phone', 'role', 'region', 'sortOrder'].some(
      (key) => Object.prototype.hasOwnProperty.call(body, key),
    );

    if (!hasContactFields) {
      if (typeof body.isActive !== 'boolean') {
        return NextResponse.json(
          { error: 'Provide contact fields to edit or isActive to change status' },
          { status: 400 },
        );
      }
      const row = await setEmergencyContactActive(
        tenantId,
        id,
        body.isActive,
        session.user.id,
      );
      if (!row) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      return NextResponse.json({ data: row });
    }

    const { name, phone, role, region, sortOrder, isActive } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!phone?.trim()) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }
    if (!role?.trim() || !isEmergencyContactRole(role)) {
      return NextResponse.json({ error: 'A valid contact role is required' }, { status: 400 });
    }

    const row = await updateEmergencyContact(
      tenantId,
      id,
      {
        name: name.trim(),
        phone: phone.trim(),
        role,
        region: typeof region === 'string' && region.trim() ? region.trim() : null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 0,
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      },
      session.user.id,
    );
    if (!row) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    return NextResponse.json({ data: row });
  } catch (error) {
    if (error instanceof Error && error.message === EMERGENCY_CONTACT_EDIT_CONFLICT) {
      return NextResponse.json(
        { error: 'This emergency contact changed while the edit was being prepared. Refresh and review the current contact before trying again.' },
        { status: 409 },
      );
    }
    if (databaseCode(error) === '23505') {
      return NextResponse.json(
        { error: 'An emergency contact with this phone number and role already exists.' },
        { status: 409 },
      );
    }
    console.error('[emergency-contacts] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.EMERGENCY_CONTACTS_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const isPlatformAdmin = await hasPermission(session, Permissions.PLATFORM_ADMIN);
    const tenantId = resolveTenantId(
      session.tenantId,
      searchParams.get('tenantId'),
      isPlatformAdmin,
    );

    const row = await deleteEmergencyContact(tenantId, id, session.user.id);
    if (!row) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[emergency-contacts] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
  }
}
