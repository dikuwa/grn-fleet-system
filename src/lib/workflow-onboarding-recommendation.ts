export type TransportProcess = 'request_led' | 'programme_led' | 'mixed';
export type BudgetControl = 'conditional' | 'always' | 'none';

export type WorkflowRecommendationInput = {
  organisationType: string;
  transportProcess: TransportProcess;
  budgetControl: BudgetControl;
  acceptsExternalSponsoredRequests: boolean;
};

export type RecommendedWorkflowRoute = {
  name: string;
  presetId: string;
  requestOrigin: 'internal' | 'external' | 'programme' | null;
  financialImpact: 'none' | 'within_budget' | 'additional_funding' | null;
  rationale: string;
};

export function recommendWorkflowRoutes(
  input: WorkflowRecommendationInput,
): RecommendedWorkflowRoute[] {
  const routes: RecommendedWorkflowRoute[] = [];
  const organisationLabel = input.organisationType.replace(/_/g, ' ');
  const programmePrimary = input.transportProcess === 'programme_led';
  const programmeEnabled = programmePrimary || input.transportProcess === 'mixed';
  const internalPreset =
    input.budgetControl === 'always'
      ? 'internal_budget_controlled'
      : input.budgetControl === 'conditional'
        ? 'internal_organisational'
        : 'standard';

  if (programmeEnabled) {
    routes.push({
      name: programmePrimary ? 'Programme transport (primary)' : 'Programme transport',
      presetId: 'programme_transport',
      requestOrigin: 'programme',
      financialImpact: null,
      rationale: `Uses the recorded programme-led process for this ${organisationLabel} and starts from an approved programme.`,
    });
  }

  routes.push({
    name: programmePrimary ? 'Ad hoc transport (secondary)' : 'Internal transport',
    presetId: internalPreset,
    requestOrigin: 'internal',
    financialImpact: input.budgetControl === 'always' ? null : 'none',
    rationale: programmePrimary
      ? 'Keeps a secondary ad hoc path without displacing programme-led planning.'
      : `Supports staff-originated requests for this ${organisationLabel} through the tenant workflow engine.`,
  });

  if (input.budgetControl === 'conditional') {
    routes.push({
      name: 'Internal transport with financial impact',
      presetId: 'internal_budget_controlled',
      requestOrigin: 'internal',
      financialImpact: 'within_budget',
      rationale: 'Adds governed Finance / Budget Review only where the request declares a cost impact.',
    });
    routes.push({
      name: 'Internal transport requiring funding',
      presetId: 'internal_budget_controlled',
      requestOrigin: 'internal',
      financialImpact: 'additional_funding',
      rationale: 'Records budget evidence before operational transport review and final authorisation.',
    });
  }

  if (input.acceptsExternalSponsoredRequests) {
    if (input.budgetControl === 'always') {
      routes.push({
        name: 'Sponsored or external transport',
        presetId: 'sponsored_external_first',
        requestOrigin: 'external',
        financialImpact: null,
        rationale:
          'Places the responsible Director / Sponsor first, then requires Finance / Budget Review before transport governance.',
      });
    } else if (input.budgetControl === 'conditional') {
      routes.push({
        name: 'Sponsored or external transport — no financial impact',
        presetId: 'sponsored_external_organisational',
        requestOrigin: 'external',
        financialImpact: 'none',
        rationale:
          'Places the responsible Director / Sponsor first and skips Finance review when no financial impact is declared.',
      });
      routes.push({
        name: 'Sponsored or external transport — within budget',
        presetId: 'sponsored_external_first',
        requestOrigin: 'external',
        financialImpact: 'within_budget',
        rationale:
          'Places the responsible Director / Sponsor first, then records the applicable Finance / Budget Review.',
      });
      routes.push({
        name: 'Sponsored or external transport — additional funding',
        presetId: 'sponsored_external_first',
        requestOrigin: 'external',
        financialImpact: 'additional_funding',
        rationale:
          'Places the responsible Director / Sponsor first, then records funding approval before transport governance.',
      });
    } else {
      routes.push({
        name: 'Sponsored or external transport',
        presetId: 'sponsored_external_organisational',
        requestOrigin: 'external',
        financialImpact: null,
        rationale:
          'Places the responsible Director / Sponsor first without adding a Finance gate that this organisation does not use.',
      });
    }
  }

  return routes;
}
