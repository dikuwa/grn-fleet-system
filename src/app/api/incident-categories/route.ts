/**
 * Incident Categories API
 *
 * GET /api/incident-categories — List active incident categories for the tenant
 * POST /api/incident-categories — Upsert a category (transport admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  listIncidentCategories,
  upsertIncidentCategory,
  categorizeGroup,
} from '@/lib/incidents/categories';

// ---------------------------------------------------------------------------
// GET — List categories for the tenant
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const rows = await listIncidentCategories(session.tenantId, { includeInactive });

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('[incident-categories] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch incident categories' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Upsert a category (transport admin)
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TRIP_INCIDENT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const { code, name, group, sortOrder, requiresMvaForm, isActive } = body;

    if (!code || !name || !group) {
      return NextResponse.json(
        { error: 'Code, name and group are required' },
        { status: 400 },
      );
    }

    const row = await upsertIncidentCategory(
      session.tenantId,
      {
        code: code.trim(),
        name: name.trim(),
        group: categorizeGroup(group),
        sortOrder: sortOrder != null ? Number(sortOrder) : undefined,
        requiresMvaForm: requiresMvaForm === true,
        isActive: isActive !== false,
      },
      session.user.id,
    );

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    console.error('[incident-categories] POST failed:', error);
    return NextResponse.json({ error: 'Failed to save incident category' }, { status: 500 });
  }
}
