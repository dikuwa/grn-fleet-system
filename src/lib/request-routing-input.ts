import {
  FINANCIAL_IMPACTS,
  normaliseRequestOrigin,
  type FinancialImpact,
  type RequestOrigin,
} from '@/lib/workflow-route-resolver';

export type RequestRoutingFields = {
  requestOrigin: RequestOrigin;
  financialImpact: FinancialImpact;
  tripCategory: string;
  estimatedCost: string | null;
  currency: 'NAD';
  costCentre: string | null;
  fundingSource: string | null;
  budgetReference: string | null;
};

export type RequestRoutingInputResult =
  | { ok: true; fields: RequestRoutingFields }
  | { ok: false; error: string };

function optionalText(value: unknown, maxLength = 120): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function parseRequestRoutingInput(
  value: Record<string, unknown>,
  options: { requesterType?: unknown; hasProgramme?: boolean } = {},
): RequestRoutingInputResult {
  const requestedImpact = value.financialImpact ?? 'none';
  if (!FINANCIAL_IMPACTS.includes(requestedImpact as FinancialImpact)) {
    return { ok: false, error: 'Financial impact must be none, within budget, or additional funding.' };
  }

  const rawCategory = String(value.tripCategory ?? 'general').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(rawCategory)) {
    return { ok: false, error: 'Trip category is invalid.' };
  }

  let estimatedCost: string | null = null;
  if (value.estimatedCost != null && value.estimatedCost !== '') {
    const amount = Number(value.estimatedCost);
    if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999.99) {
      return { ok: false, error: 'Estimated cost must be a valid non-negative NAD amount.' };
    }
    estimatedCost = amount.toFixed(2);
  }

  return {
    ok: true,
    fields: {
      requestOrigin: normaliseRequestOrigin(
        value.requestOrigin ?? options.requesterType,
        Boolean(options.hasProgramme),
      ),
      financialImpact: requestedImpact as FinancialImpact,
      tripCategory: rawCategory,
      estimatedCost,
      currency: 'NAD',
      costCentre: optionalText(value.costCentre),
      fundingSource: optionalText(value.fundingSource),
      budgetReference: optionalText(value.budgetReference),
    },
  };
}
