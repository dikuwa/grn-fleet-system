import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackupSchedules } from '@/db/schema/data-protection';
import { tenants } from '@/db/schema/tenants';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { nextScheduleRun } from '@/lib/data-protection/backup-service';
import { isUuid } from '@/lib/uuid';

const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

function parseRetentionDays(value: unknown, fallback: number) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) return null;
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const tenantId = typeof body.tenantId === 'string' && body.tenantId ? body.tenantId : null;
    if (tenantId && !isUuid(tenantId)) {
      return NextResponse.json({ error: 'tenantId must be a valid UUID' }, { status: 400 });
    }
    const frequency = typeof body.frequency === 'string' ? body.frequency : 'monthly';
    const retentionDays = parseRetentionDays(body.retentionDays, 90);
    if (!FREQUENCIES.includes(frequency as (typeof FREQUENCIES)[number])) {
      return NextResponse.json(
        { error: 'frequency must be daily, weekly, or monthly' },
        { status: 400 },
      );
    }
    if (retentionDays == null) {
      return NextResponse.json(
        { error: 'retentionDays must be an integer between 1 and 3650' },
        { status: 400 },
      );
    }

    const db = getDb();
    if (tenantId) {
      const [tenant] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const [created] = await db
      .insert(platformBackupSchedules)
      .values({
        tenantId,
        frequency,
        retentionDays,
        enabled: true,
        nextRunAt: nextScheduleRun(frequency),
        createdByUserId: session.user.id,
      })
      .returning();
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'schedule id is required' }, { status: 400 });
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'schedule id must be a valid UUID' }, { status: 400 });
    }

    const db = getDb();
    const [current] = await db
      .select()
      .from(platformBackupSchedules)
      .where(eq(platformBackupSchedules.id, id))
      .limit(1);
    if (!current)
      return NextResponse.json({ error: 'Backup schedule not found' }, { status: 404 });

    const frequency = typeof body.frequency === 'string' ? body.frequency : current.frequency;
    if (!FREQUENCIES.includes(frequency as (typeof FREQUENCIES)[number]))
      return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 });
    const retentionDays = parseRetentionDays(body.retentionDays, current.retentionDays);
    if (retentionDays == null) {
      return NextResponse.json(
        { error: 'retentionDays must be an integer between 1 and 3650' },
        { status: 400 },
      );
    }
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;

    const [updated] = await db
      .update(platformBackupSchedules)
      .set({
        frequency,
        retentionDays,
        enabled,
        nextRunAt: frequency !== current.frequency ? nextScheduleRun(frequency) : current.nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(platformBackupSchedules.id, id))
      .returning();
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'schedule id is required' }, { status: 400 });
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'schedule id must be a valid UUID' }, { status: 400 });
    }
    const db = getDb();
    const [deleted] = await db
      .delete(platformBackupSchedules)
      .where(eq(platformBackupSchedules.id, id))
      .returning({ id: platformBackupSchedules.id });
    if (!deleted)
      return NextResponse.json({ error: 'Backup schedule not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
