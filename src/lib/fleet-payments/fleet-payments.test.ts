import { afterEach, describe, expect, it } from 'vitest';
import { maskFleetPaymentIdentifier } from '@/lib/fleet-payments/service';
import { providerConnectionReadiness } from '@/lib/fleet-payments/provider-adapter';
import { OPERATIONAL_DELETE_STEPS, PRESERVED_TABLES } from '@/lib/data-reset/config';

const baseProvider = {
  id: 'provider-1',
  tenantId: 'tenant-1',
  providerType: 'standard_bank_bluefuel',
  providerName: 'Standard Bank BlueFuel',
  integrationMode: 'manual',
  isDefault: true,
  requireForRelease: false,
  status: 'active',
  apiBaseUrl: null,
  apiClientId: null,
  apiSecretEnvKey: null,
  externalAccountReference: null,
  config: {},
  createdByUserId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(() => {
  delete process.env.TEST_FLEET_PROVIDER_SECRET;
});

describe('fleet payment credential safety', () => {
  it('only exposes the final four characters of a supplied identifier', () => {
    expect(maskFleetPaymentIdentifier('1234 5678 9012 4821')).toBe('•••• 4821');
    expect(maskFleetPaymentIdentifier('TAG-ABCD')).toBe('•••• ABCD');
  });
});

describe('provider integration readiness', () => {
  it('keeps manual and file-import operation usable without a bank API contract', () => {
    expect(providerConnectionReadiness(baseProvider as never)).toMatchObject({ mode: 'manual', ready: true });
    expect(
      providerConnectionReadiness({ ...baseProvider, integrationMode: 'file_import' } as never),
    ).toMatchObject({ mode: 'file_import', ready: true });
  });

  it('does not pretend BlueFuel API mode is ready without provider-supplied contract details', () => {
    const result = providerConnectionReadiness({ ...baseProvider, integrationMode: 'api' } as never);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain('API base URL');
    expect(result.missing).toContain('approved transaction endpoint path');
  });

  it('accepts API transport only after endpoint/header contract and environment secret are present', () => {
    process.env.TEST_FLEET_PROVIDER_SECRET = 'secret-is-not-stored-in-db';
    const result = providerConnectionReadiness({
      ...baseProvider,
      integrationMode: 'api',
      apiBaseUrl: 'https://provider.example.test',
      apiClientId: 'app-key',
      apiSecretEnvKey: 'TEST_FLEET_PROVIDER_SECRET',
      config: {
        transactionsPath: '/approved/transactions',
        secretHeaderName: 'x-provider-secret',
        clientIdHeaderName: 'x-api-key',
      },
    } as never);
    expect(result).toMatchObject({ mode: 'api', ready: true, missing: [] });
  });
});

describe('operational reset policy', () => {
  it('clears assignment/transaction history but preserves provider and instrument setup', () => {
    expect(OPERATIONAL_DELETE_STEPS.map((step) => step.table)).toEqual(
      expect.arrayContaining(['fleet_payment_assignments', 'fleet_payment_transactions']),
    );
    expect(PRESERVED_TABLES.map((step) => step.table)).toEqual(
      expect.arrayContaining(['fleet_payment_providers', 'fleet_payment_instruments']),
    );
  });
});
