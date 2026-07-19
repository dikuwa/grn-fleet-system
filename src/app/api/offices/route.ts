/**
 * Offices API
 *
 * GET  /api/offices       — List offices for the tenant
 * POST /api/offices       — Create a new office
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { offices } from '@/db/schema/people';
import { eq, and, asc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const allOffices = await db
      .select()
      .from(offices)
      .where(and(eq(offices.tenantId, session.tenantId), eq(offices.isActive, true)))
      .orderBy(asc(offices.name));

    return NextResponse.json({ success: true, data: allOffices });
  } catch (error) {
    console.error('[Offices] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list offices' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { name, code, type, parentId, address, phone, email } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Office name is required' }, { status: 400 });
    }

    const db = getDb();
    const [office] = await db
      .insert(offices)
      .values({
        tenantId: session.tenantId,
        name: name.trim(),
        code: code?.trim() || null,
        type: type || 'constituency_office',
        parentId: parentId || null,
        address: address || null,
        phone: phone || null,
        email: email || null,
      })
      .returning();

    return NextResponse.json({ success: true, data: office }, { status: 201 });
  } catch (error) {
    console.error('[Offices] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create office' }, { status: 500 });
  }
}
