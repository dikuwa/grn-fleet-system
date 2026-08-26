import { describe, expect, it } from 'vitest';
import { recommendWorkflowRoutes } from './workflow-onboarding-recommendation';

describe('workflow onboarding recommendations', () => {
  it('recommends programme-first and secondary ad hoc routes from process facts', () => {
    const routes = recommendWorkflowRoutes({
      organisationType: 'municipality',
      transportProcess: 'programme_led',
      budgetControl: 'none',
      acceptsExternalSponsoredRequests: false,
    });
    expect(routes.map((route) => route.presetId)).toEqual(['programme_transport', 'standard']);
    expect(routes[1].name).toContain('secondary');
  });

  it('makes Finance review conditional for internal and sponsored external requests', () => {
    const routes = recommendWorkflowRoutes({
      organisationType: 'ministry',
      transportProcess: 'request_led',
      budgetControl: 'conditional',
      acceptsExternalSponsoredRequests: true,
    });

    const external = routes.filter((route) => route.requestOrigin === 'external');
    expect(routes[0].presetId).toBe('internal_organisational');
    expect(routes.some((route) => route.requestOrigin === 'internal' && route.financialImpact === 'additional_funding')).toBe(true);
    expect(external).toEqual([
      expect.objectContaining({
        presetId: 'sponsored_external_organisational',
        financialImpact: 'none',
      }),
      expect.objectContaining({
        presetId: 'sponsored_external_first',
        financialImpact: 'within_budget',
      }),
      expect.objectContaining({
        presetId: 'sponsored_external_first',
        financialImpact: 'additional_funding',
      }),
    ]);
  });

  it('does not introduce Finance review for sponsored requests when the tenant disables it', () => {
    const routes = recommendWorkflowRoutes({
      organisationType: 'public_enterprise',
      transportProcess: 'request_led',
      budgetControl: 'none',
      acceptsExternalSponsoredRequests: true,
    });
    const external = routes.find((route) => route.requestOrigin === 'external');
    expect(external).toMatchObject({
      presetId: 'sponsored_external_organisational',
      financialImpact: null,
    });
  });

  it('keeps Finance review on every sponsored request when the tenant requires it', () => {
    const routes = recommendWorkflowRoutes({
      organisationType: 'ministry',
      transportProcess: 'request_led',
      budgetControl: 'always',
      acceptsExternalSponsoredRequests: true,
    });
    const external = routes.find((route) => route.requestOrigin === 'external');
    expect(external).toMatchObject({
      presetId: 'sponsored_external_first',
      financialImpact: null,
    });
  });
});
