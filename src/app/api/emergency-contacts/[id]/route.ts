/**
 * Emergency Contact detail API
 *
 * PATCH /api/emergency-contacts/[id] — Toggle active status or update contact
 * DELETE /api/emergency-contacts/[id] — Soft delete (deactivate) an emergency contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  setEmergencyContactActive,
  deleteEmergencyContact,
} from '@/lib/incidents/emergency-contacts';

// ---------------------------------------------------------------------------
// PATCH — Toggle active status
// ---------------------------------------------------------------------------

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
    const { isActive } = body;

    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive (boolean) is required' }, { status: 400 });
    }

    const row = await setEmergencyContactActive(session.tenantId, id, isActive, session.user.id);
    if (!row) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error('[emergency-contacts] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove an emergency contact
// ---------------------------------------------------------------------------

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
    const row = await deleteEmergencyContact(session.tenantId, id, session.user.id);
    if (!row) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[emergency-contacts] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
  }
}
