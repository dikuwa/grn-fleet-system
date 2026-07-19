/**
 * Departments API
 *
 * GET  /api/departments       — List departments for the tenant
 * POST /api/departments       — Create a new department
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departments } from '@/db/schema/people';
import { eq, and, asc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const allDepts = await db
      .select()
      .from(departments)
      .where(and(eq(departments.tenantId, session.tenantId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name));

    return NextResponse.json({ success: true, data: allDepts });
  } catch (error) {
    console.error('[Departments] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list departments' }, { status: 500 });
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
    const { name, code } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Department name is required' }, { status: 400 });
    }

    const db = getDb();
    const [dept] = await db
      .insert(departments)
      .values({
        tenantId: session.tenantId,
        name: name.trim(),
        code: code?.trim() || null,
      })
      .returning();

    return NextResponse.json({ success: true, data: dept }, { status: 201 });
  } catch (error) {
    console.error('[Departments] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create department' }, { status: 500 });
  }
}
