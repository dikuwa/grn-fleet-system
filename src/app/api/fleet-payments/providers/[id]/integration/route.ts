import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { fleetPaymentProviders } from '@/db/schema/fleet-payments';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { providerConnectionReadiness } from '@/lib/fleet-payments/provider-adapter';
import { recordAuditEvent } from '@/lib/audit-event';

type ApiConfig = {
  transactionsPath?: string;
  secretHeaderName?: string;
  clientIdHeaderName?: string;
  additionalHeaders?: Record<string, string>;
};

function safeApiConfig(value: unknown): ApiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const additionalHeaders: Record<string, string> = {};
  if (input.additionalHeaders && typeof input.additionalHeaders === 'object' && !Array.isArray(input.additionalHeaders)) {
    for (const [key, headerValue] of Object.entries(input.additionalHeaders as Record<string, unknown>)) {
      if (typeof headerValue === 'string' && key.trim() && headerValue.trim()) {
        additionalHeaders[key.trim()] = headerValue.trim();
      }
    }
  }
  return {
    transactionsPath: typeof input.transactionsPath === 'string' ? input.transactionsPath.trim() || undefined : undefined,
    secretHeaderName: typeof input.secretHeaderName === 'string' ? input.secretHeaderName.trim() || undefined : undefined,
    clientIdHeaderName: typeof input.clientIdHeaderName === 'string' ? input.clientIdHeaderName.trim() || undefined : undefined,
    additionalHeaders: Object.keys(additionalHeaders).length ? additionalHeaders : undefined,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const { id } = await context.params;
  const db = getDb();
  const [provider] = await db
    .select()
    .from(fleetPaymentProviders)
    .where(and(eq(fleetPaymentProviders.id, id), eq(fleetPaymentProviders.tenantId, session.tenantId)))
    .limit(1);
  if (!provider) return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
  return NextResponse.json({
    success: true,
    data: {
      providerId: provider.id,
      providerName: provider.providerName,
      integrationMode: provider.integrationMode,
      apiBaseUrl: provider.apiBaseUrl,
      apiClientId: provider.apiClientId,
      apiSecretEnvKey: provider.apiSecretEnvKey,
      apiConfig: safeApiConfig(provider.config),
      readiness: providerConnectionReadiness(provider),
    },
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const db = getDb();
  const [provider] = await db
    .select()
    .from(fleetPaymentProviders)
    .where(and(eq(fleetPaymentProviders.id, id), eq(fleetPaymentProviders.tenantId, session.tenantId)))
    .limit(1);
  if (!provider) return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });

  const apiConfig = safeApiConfig(body.apiConfig ?? provider.config);
  const apiBaseUrl = typeof body.apiBaseUrl === 'string' ? body.apiBaseUrl.trim() || null : provider.apiBaseUrl;
  const apiClientId = typeof body.apiClientId === 'string' ? body.apiClientId.trim() || null : provider.apiClientId;
  const apiSecretEnvKey =
    typeof body.apiSecretEnvKey === 'string' ? body.apiSecretEnvKey.trim() || null : provider.apiSecretEnvKey;
  if (apiBaseUrl) {
    try {
      const parsed = new URL(apiBaseUrl);
      if (parsed.protocol !== 'https:') throw new Error('not https');
    } catch {
      return NextResponse.json({ error: 'Provider API base URL must be a valid HTTPS URL.' }, { status: 422 });
    }
  }
  if (apiSecretEnvKey && !/^[A-Z][A-Z0-9_]{2,127}$/.test(apiSecretEnvKey)) {
    return NextResponse.json(
      { error: 'Secret environment key must be an uppercase environment variable name, not the secret value.' },
      { status: 422 },
    );
  }
  if (Object.values(apiConfig.additionalHeaders ?? {}).some((value) => /bearer\s|basic\s|secret|password|token/i.test(value))) {
    return NextResponse.json(
      { error: 'Do not store secret/token values in additional headers. Reference secrets through the environment key.' },
      { status: 422 },
    );
  }

  const mergedConfig = {
    ...(provider.config ?? {}),
    ...apiConfig,
  };
  await db
    .update(fleetPaymentProviders)
    .set({
      apiBaseUrl,
      apiClientId,
      apiSecretEnvKey,
      config: mergedConfig,
      updatedAt: new Date(),
    })
    .where(and(eq(fleetPaymentProviders.id, id), eq(fleetPaymentProviders.tenantId, session.tenantId)));
  const [updated] = await db.select().from(fleetPaymentProviders).where(eq(fleetPaymentProviders.id, id)).limit(1);
  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    action: 'fleet_payment_provider.integration_configured',
    entityType: 'fleet_payment_provider',
    entityId: id,
    summary: `${provider.providerName} integration configuration updated`,
    before: { integrationMode: provider.integrationMode, apiBaseUrl: provider.apiBaseUrl, apiClientId: provider.apiClientId },
    after: { integrationMode: updated?.integrationMode, apiBaseUrl: updated?.apiBaseUrl, apiClientId: updated?.apiClientId },
  });
  return NextResponse.json({ success: true, data: { readiness: updated ? providerConnectionReadiness(updated) : null } });
}
