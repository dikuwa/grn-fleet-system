import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { legalPolicyRegister } from '@/db/schema';
import { hasPermission, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

const STATUSES = ['in_force', 'uncommenced', 'repealed', 'internal_policy'] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textValue(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function dateValue(value: unknown): string | null | undefined {
  const normalized = textValue(value, 10);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function entryInput(body: Record<string, unknown>) {
  const title = textValue(body.title, 250);
  const instrumentType = textValue(body.instrumentType, 80);
  const citation = textValue(body.citation, 150);
  const applicability = textValue(body.applicability, 2_000);
  const status = textValue(body.status, 40) ?? 'in_force';
  if (!title || !instrumentType || !citation || !applicability) {
    return {
      ok: false as const,
      error: 'Title, instrument type, citation and applicability are required.',
    };
  }
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return { ok: false as const, error: 'Register status is invalid.' };
  }
  const sourceUrl = textValue(body.sourceUrl, 1_000);
  const effectiveDate = dateValue(body.effectiveDate);
  const reviewDueDate = dateValue(body.reviewDueDate);
  if (effectiveDate === undefined || reviewDueDate === undefined) {
    return { ok: false as const, error: 'Effective and review dates must use YYYY-MM-DD.' };
  }
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
    } catch {
      return { ok: false as const, error: 'Source URL must be a valid HTTP or HTTPS address.' };
    }
  }
  return {
    ok: true as const,
    value: {
      title,
      instrumentType,
      citation,
      applicability,
      status,
      sourceUrl,
      effectiveDate,
      responsibleOffice: textValue(body.responsibleOffice, 250),
      reviewDueDate,
      notes: textValue(body.notes, 4_000),
    },
  };
}

function legalPolicyRevisionMatches(updatedAt: Date) {
  return sql`date_trunc('milliseconds', ${legalPolicyRegister.updatedAt}) = ${updatedAt.toISOString()}::timestamptz`;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.LEGAL_POLICY_VIEW);
  if (permission instanceof NextResponse) return permission;

  const rows = await getDb()
    .select()
    .from(legalPolicyRegister)
    .where(eq(legalPolicyRegister.tenantId, auth.session.tenantId))
    .orderBy(asc(legalPolicyRegister.title));
  const canManage = await hasPermission(auth.session, Permissions.LEGAL_POLICY_MANAGE);
  return NextResponse.json({ success: true, data: rows, canManage });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.LEGAL_POLICY_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const parsed = entryInput((await request.json()) as Record<string, unknown>);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  try {
    const [created] = await getDb()
      .insert(legalPolicyRegister)
      .values({
        tenantId: auth.session.tenantId,
        ...parsed.value,
        createdByUserId: auth.session.user.id,
        updatedByUserId: auth.session.user.id,
      })
      .returning();
    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'create',
      eventType: 'legal_policy_entry_created',
      entityType: 'legal_policy_register',
      entityId: created.id,
      after: created,
      summary: `${created.citation} added to the Legal & Policy Register`,
    });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (String(error).includes('legal_policy_register_tenant_citation_unique')) {
      return NextResponse.json({ error: 'This citation is already registered.' }, { status: 409 });
    }
    console.error('[LegalPolicy] create failed:', error);
    return NextResponse.json({ error: 'Failed to create register entry.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.LEGAL_POLICY_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const body = (await request.json()) as Record<string, unknown>;
  const id = textValue(body.id, 50);
  const parsed = entryInput(body);
  if (!id) return NextResponse.json({ error: 'Entry id is required.' }, { status: 422 });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Register entry not found.' }, { status: 404 });
  }

  const db = getDb();
  const [before] = await db
    .select()
    .from(legalPolicyRegister)
    .where(
      and(
        eq(legalPolicyRegister.id, id),
        eq(legalPolicyRegister.tenantId, auth.session.tenantId),
      ),
    )
    .limit(1);
  if (!before) return NextResponse.json({ error: 'Register entry not found.' }, { status: 404 });

  try {
    const [updated] = await db
      .update(legalPolicyRegister)
      .set({ ...parsed.value, updatedByUserId: auth.session.user.id, updatedAt: new Date() })
      .where(
        and(
          eq(legalPolicyRegister.id, id),
          eq(legalPolicyRegister.tenantId, auth.session.tenantId),
          legalPolicyRevisionMatches(before.updatedAt),
        ),
      )
      .returning();
    if (!updated) {
      return NextResponse.json(
        { error: 'This register entry changed while the update was being prepared. Refresh and review the current entry before trying again.' },
        { status: 409 },
      );
    }

    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'update',
      eventType: 'legal_policy_entry_updated',
      entityType: 'legal_policy_register',
      entityId: id,
      before,
      after: updated,
      summary: `${updated.citation} updated in the Legal & Policy Register`,
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (String(error).includes('legal_policy_register_tenant_citation_unique')) {
      return NextResponse.json({ error: 'This citation is already registered.' }, { status: 409 });
    }
    console.error('[LegalPolicy] update failed:', error);
    return NextResponse.json({ error: 'Failed to update register entry.' }, { status: 500 });
  }
}
