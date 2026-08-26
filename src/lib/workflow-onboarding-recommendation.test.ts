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

  it('recommends conditional finance and sponsor-first routes without a tenant mode', () => {
    const routes = recommendWorkflowRoutes({
      organisationType: 'ministry',
      transportProcess: 'request_led',
      budgetControl: 'conditional',
      acceptsExternalSponsoredRequests: true,
    });
    expect(routes.some((route) => route.financialImpact === 'additional_funding')).toBe(true);
    expect(routes[0].presetId).toBe('internal_organisational');
    expect(routes.at(-1)?.presetId).toBe('sponsored_external_first');
  });
});
