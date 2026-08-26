import {
  parseRequestRoutingInput,
  type RequestRoutingFields,
  type RequestRoutingInputResult,
} from '@/lib/request-routing-input';

export type ExistingRequestRouting = {
  requesterType: string | null;
  requestOrigin: string | null;
  programmeId: string | null;
  financialImpact: string | null;
  tripCategory: string | null;
  estimatedCost: string | null;
  currency: string | null;
  costCentre: string | null;
  fundingSource: string | null;
  budgetReference: string | null;
};

export function parseRequestRoutingCorrection(
  value: Record<string, unknown>,
  existing: ExistingRequestRouting,
): RequestRoutingInputResult {
  const parsed = parseRequestRoutingInput(
    {
      ...value,
      requestOrigin: existing.requestOrigin ?? existing.requesterType ?? 'internal',
    },
    {
      requesterType: existing.requesterType ?? 'internal',
      hasProgramme: Boolean(existing.programmeId),
    },
  );

  if (!parsed.ok) return parsed;

  if (parsed.fields.financialImpact === 'none') {
    return {
      ok: true,
      fields: {
        ...parsed.fields,
        estimatedCost: null,
        costCentre: null,
        fundingSource: null,
        budgetReference: null,
      },
    };
  }

  return parsed;
}

export function requestRoutingChanged(
  existing: ExistingRequestRouting,
  fields: RequestRoutingFields,
): boolean {
  return (
    (existing.requestOrigin ?? 'internal') !== fields.requestOrigin ||
    (existing.financialImpact ?? 'none') !== fields.financialImpact ||
    (existing.tripCategory ?? 'general') !== fields.tripCategory ||
    (existing.estimatedCost ?? null) !== fields.estimatedCost ||
    (existing.currency ?? 'NAD') !== fields.currency ||
    (existing.costCentre ?? null) !== fields.costCentre ||
    (existing.fundingSource ?? null) !== fields.fundingSource ||
    (existing.budgetReference ?? null) !== fields.budgetReference
  );
}
