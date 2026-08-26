export const REQUEST_ORIGINS = ['internal', 'external', 'programme'] as const;
export const FINANCIAL_IMPACTS = ['none', 'within_budget', 'additional_funding'] as const;

export type RequestOrigin = (typeof REQUEST_ORIGINS)[number];
export type FinancialImpact = (typeof FINANCIAL_IMPACTS)[number];

export type WorkflowRouteContext = {
  tripScope: string;
  regionId: string | null;
  officeId: string | null;
  departmentId: string | null;
  requestOrigin: RequestOrigin;
  financialImpact: FinancialImpact;
  tripCategory: string;
};

export type WorkflowRouteCandidate = {
  id: string;
  version: number;
  tripScope: string;
  regionId: string | null;
  officeId: string | null;
  departmentId: string | null;
  requestOrigin: string | null;
  financialImpact: string | null;
  tripCategory: string | null;
};

export type WorkflowRouteResolution<T extends WorkflowRouteCandidate> =
  | { status: 'matched'; definition: T; specificity: number }
  | { status: 'no_match' }
  | { status: 'ambiguous'; candidates: T[]; specificity: number };

const CONDITION_KEYS = [
  'regionId',
  'officeId',
  'departmentId',
  'requestOrigin',
  'financialImpact',
  'tripCategory',
] as const;

function matches(candidate: WorkflowRouteCandidate, context: WorkflowRouteContext): boolean {
  if (candidate.tripScope !== context.tripScope) return false;
  return CONDITION_KEYS.every((key) => candidate[key] == null || candidate[key] === context[key]);
}

export function workflowRouteSpecificity(candidate: WorkflowRouteCandidate): number {
  return CONDITION_KEYS.reduce((score, key) => score + Number(candidate[key] != null), 0);
}

/** True when two routes can match the same request with equal precedence. */
export function workflowRoutesAreAmbiguous(
  left: WorkflowRouteCandidate,
  right: WorkflowRouteCandidate,
): boolean {
  if (left.tripScope !== right.tripScope) return false;
  if (workflowRouteSpecificity(left) !== workflowRouteSpecificity(right)) return false;
  return CONDITION_KEYS.every(
    (key) => left[key] == null || right[key] == null || left[key] === right[key],
  );
}

/**
 * Resolve an active tenant route without silently guessing between equally
 * specific definitions. Publishing will prevent ambiguity, while this runtime
 * guard keeps requests safe if older or manually edited data overlaps.
 */
export function resolveWorkflowRoute<T extends WorkflowRouteCandidate>(
  candidates: T[],
  context: WorkflowRouteContext,
): WorkflowRouteResolution<T> {
  const matchesBySpecificity = candidates
    .filter((candidate) => matches(candidate, context))
    .map((candidate) => ({ candidate, specificity: workflowRouteSpecificity(candidate) }))
    .sort(
      (left, right) =>
        right.specificity - left.specificity || right.candidate.version - left.candidate.version,
    );

  const first = matchesBySpecificity[0];
  if (!first) return { status: 'no_match' };

  const equallySpecific = matchesBySpecificity
    .filter((entry) => entry.specificity === first.specificity)
    .map((entry) => entry.candidate);
  if (equallySpecific.length > 1) {
    return { status: 'ambiguous', candidates: equallySpecific, specificity: first.specificity };
  }

  return { status: 'matched', definition: first.candidate, specificity: first.specificity };
}

export function normaliseRequestOrigin(value: unknown, hasProgramme: boolean): RequestOrigin {
  if (hasProgramme) return 'programme';
  return value === 'external' ? 'external' : 'internal';
}

export function normaliseFinancialImpact(value: unknown): FinancialImpact {
  return FINANCIAL_IMPACTS.includes(value as FinancialImpact)
    ? (value as FinancialImpact)
    : 'none';
}
