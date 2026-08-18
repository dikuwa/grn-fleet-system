import type { fleetPaymentProviders } from '@/db/schema/fleet-payments';

type ProviderRow = typeof fleetPaymentProviders.$inferSelect;

type ApiConfig = {
  transactionsPath?: string;
  secretHeaderName?: string;
  clientIdHeaderName?: string;
  additionalHeaders?: Record<string, string>;
};

export type ProviderConnectionReadiness = {
  mode: string;
  ready: boolean;
  missing: string[];
  message: string;
};

/**
 * Standard Bank's public developer onboarding can issue application credentials,
 * but GRN FLEET does not assume a private BlueFuel endpoint, header name or
 * response contract. Those values are supplied only after the tenant/provider
 * receives an approved integration contract.
 */
export function providerConnectionReadiness(provider: ProviderRow): ProviderConnectionReadiness {
  if (provider.integrationMode === 'manual') {
    return { mode: 'manual', ready: true, missing: [], message: 'Manual capture is ready.' };
  }
  if (provider.integrationMode === 'file_import') {
    return { mode: 'file_import', ready: true, missing: [], message: 'CSV/Excel-compatible import is ready.' };
  }

  const config = (provider.config ?? {}) as ApiConfig;
  const missing: string[] = [];
  if (!provider.apiBaseUrl) missing.push('API base URL');
  if (!provider.apiClientId) missing.push('application/API key');
  if (!provider.apiSecretEnvKey) missing.push('secret environment key');
  if (!config.transactionsPath) missing.push('approved transaction endpoint path');
  if (!config.secretHeaderName) missing.push('approved secret/auth header name');
  const secret = provider.apiSecretEnvKey ? process.env[provider.apiSecretEnvKey] : undefined;
  if (provider.apiSecretEnvKey && !secret) missing.push(`environment secret ${provider.apiSecretEnvKey}`);

  return {
    mode: 'api',
    ready: missing.length === 0,
    missing,
    message:
      missing.length === 0
        ? 'API transport is configured. Response mapping must match the provider contract.'
        : `API mode is staged but not active: ${missing.join(', ')}.` ,
  };
}

/**
 * Contract-neutral authenticated JSON transport. It deliberately requires the
 * bank/provider supplied endpoint and header names rather than guessing a
 * BlueFuel API contract. No driver PIN or card secret is ever accepted here.
 */
export async function fetchFleetProviderJson(provider: ProviderRow, query = ''): Promise<unknown> {
  const readiness = providerConnectionReadiness(provider);
  if (!readiness.ready || provider.integrationMode !== 'api') {
    throw new Error(readiness.message);
  }
  const config = (provider.config ?? {}) as ApiConfig;
  const base = provider.apiBaseUrl!.replace(/\/$/, '');
  const path = config.transactionsPath!.startsWith('/')
    ? config.transactionsPath!
    : `/${config.transactionsPath!}`;
  const secret = process.env[provider.apiSecretEnvKey!]!;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(config.additionalHeaders ?? {}),
    [config.secretHeaderName!]: secret,
  };
  if (config.clientIdHeaderName && provider.apiClientId) {
    headers[config.clientIdHeaderName] = provider.apiClientId;
  }
  const response = await fetch(`${base}${path}${query}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Fleet payment provider returned HTTP ${response.status}.`);
  }
  return response.json();
}
