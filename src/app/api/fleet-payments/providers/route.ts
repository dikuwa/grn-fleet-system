import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, ne } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  FLEET_PAYMENT_INTEGRATION_MODES,
  FLEET_PAYMENT_PROVIDER_TYPES,
  fleetPaymentProviders,
} from '@/db/schema/fleet-payments';
import { hasPermission, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { recordAuditEvent } from '@/lib/audit-event';

async function canView(session: Parameters<typeof hasPermission>[0]) {
  const checks = await Promise.all([
    hasPermission(session, Permissions.TENANT_MANAGE),
    hasPermission(session, Permissions.FUEL_MANAGE),
    hasPermission(session, Permissions.TRIP_MANAGE),
  ]);
  return checks.some(Boolean);
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  if (!(await canView(session))) {
    return NextResponse.json({ error: 'Fleet payment provider access is restricted.' }, { status: 403 });
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(fleetPaymentProviders)
    .where(eq(fleetPaymentProviders.tenantId, session.tenantId))
    .orderBy(asc(fleetPaymentProviders.providerName));
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerType = String(body.providerType || '').trim();
  const providerName = String(body.providerName || '').trim();
  const integrationMode = String(body.integrationMode || 'manual').trim();
  const isDefault = body.isDefault === true;
  if (!FLEET_PAYMENT_PROVIDER_TYPES.includes(providerType as (typeof FLEET_PAYMENT_PROVIDER_TYPES)[number])) {
    return NextResponse.json({ error: 'Select a supported fleet payment provider type.' }, { status: 422 });
  }
  if (!providerName) return NextResponse.json({ error: 'Provider name is required.' }, { status: 422 });
  if (!FLEET_PAYMENT_INTEGRATION_MODES.includes(integrationMode as (typeof FLEET_PAYMENT_INTEGRATION_MODES)[number])) {
    return NextResponse.json({ error: 'Select manual, file import or API integration.' }, { status: 422 });
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: fleetPaymentProviders.id })
    .from(fleetPaymentProviders)
    .where(
      and(
        eq(fleetPaymentProviders.tenantId, session.tenantId),
        eq(fleetPaymentProviders.providerType, providerType),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: 'This provider type is already configured for the tenant.' }, { status: 409 });
  }

  const id = randomUUID();
  const now = new Date();
  await runAtomicMutations((tx) => {
    const queries = [];
    if (isDefault) {
      queries.push(
        tx
          .update(fleetPaymentProviders)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(fleetPaymentProviders.tenantId, session.tenantId)),
      );
    }
    queries.push(
      tx.insert(fleetPaymentProviders).values({
        id,
        tenantId: session.tenantId,
        providerType,
        providerName,
        integrationMode,
        isDefault,
        requireForRelease: body.requireForRelease === true,
        status: 'active',
        apiBaseUrl: typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim() ? body.apiBaseUrl.trim() : null,
        apiClientId: typeof body.apiClientId === 'string' && body.apiClientId.trim() ? body.apiClientId.trim() : null,
        apiSecretEnvKey:
          typeof body.apiSecretEnvKey === 'string' && body.apiSecretEnvKey.trim()
            ? body.apiSecretEnvKey.trim()
            : null,
        externalAccountReference:
          typeof body.externalAccountReference === 'string' && body.externalAccountReference.trim()
            ? body.externalAccountReference.trim()
            : null,
        config: {},
        createdByUserId: session.user.id,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return queries;
  });
  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    action: 'fleet_payment_provider.created',
    entityType: 'fleet_payment_provider',
    entityId: id,
    summary: `${providerName} added as a fleet payment provider`,
    after: { providerType, integrationMode, isDefault },
  });
  const [created] = await db.select().from(fleetPaymentProviders).where(eq(fleetPaymentProviders.id, id)).limit(1);
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerId = typeof body.providerId === 'string' ? body.providerId : '';
  if (!providerId) return NextResponse.json({ error: 'Provider is required.' }, { status: 400 });

  const db = getDb();
  const [current] = await db
    .select()
    .from(fleetPaymentProviders)
    .where(
      and(eq(fleetPaymentProviders.id, providerId), eq(fleetPaymentProviders.tenantId, session.tenantId)),
    )
    .limit(1);
  if (!current) return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });

  const integrationMode = body.integrationMode ? String(body.integrationMode) : current.integrationMode;
  if (!FLEET_PAYMENT_INTEGRATION_MODES.includes(integrationMode as (typeof FLEET_PAYMENT_INTEGRATION_MODES)[number])) {
    return NextResponse.json({ error: 'Invalid integration mode.' }, { status: 422 });
  }
  const isDefault = typeof body.isDefault === 'boolean' ? body.isDefault : current.isDefault;
  const status = typeof body.status === 'string' ? body.status : current.status;
  const now = new Date();
  await runAtomicMutations((tx) => {
    const queries = [];
    if (isDefault) {
      queries.push(
        tx
          .update(fleetPaymentProviders)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(fleetPaymentProviders.tenantId, session.tenantId),
              ne(fleetPaymentProviders.id, providerId),
            ),
          ),
      );
    }
    queries.push(
      tx
        .update(fleetPaymentProviders)
        .set({
          providerName:
            typeof body.providerName === 'string' && body.providerName.trim()
              ? body.providerName.trim()
              : current.providerName,
          integrationMode,
          isDefault,
          requireForRelease:
            typeof body.requireForRelease === 'boolean' ? body.requireForRelease : current.requireForRelease,
          status,
          apiBaseUrl:
            typeof body.apiBaseUrl === 'string' ? body.apiBaseUrl.trim() || null : current.apiBaseUrl,
          apiClientId:
            typeof body.apiClientId === 'string' ? body.apiClientId.trim() || null : current.apiClientId,
          apiSecretEnvKey:
            typeof body.apiSecretEnvKey === 'string'
              ? body.apiSecretEnvKey.trim() || null
              : current.apiSecretEnvKey,
          externalAccountReference:
            typeof body.externalAccountReference === 'string'
              ? body.externalAccountReference.trim() || null
              : current.externalAccountReference,
          updatedAt: now,
        })
        .where(
          and(eq(fleetPaymentProviders.id, providerId), eq(fleetPaymentProviders.tenantId, session.tenantId)),
        ),
    );
    return queries;
  });
  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    action: 'fleet_payment_provider.updated',
    entityType: 'fleet_payment_provider',
    entityId: providerId,
    summary: `${current.providerName} fleet payment settings updated`,
    before: { integrationMode: current.integrationMode, isDefault: current.isDefault, status: current.status },
    after: { integrationMode, isDefault, status },
  });
  const [updated] = await db.select().from(fleetPaymentProviders).where(eq(fleetPaymentProviders.id, providerId)).limit(1);
  return NextResponse.json({ success: true, data: updated });
}
