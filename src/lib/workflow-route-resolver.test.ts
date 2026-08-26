import { describe, expect, it } from 'vitest';
import {
  normaliseRequestOrigin,
  resolveWorkflowRoute,
  workflowRoutesAreAmbiguous,
  type WorkflowRouteCandidate,
  type WorkflowRouteContext,
} from './workflow-route-resolver';

const context: WorkflowRouteContext = {
  tripScope: 'regional',
  regionId: 'region-1',
  officeId: 'office-1',
  departmentId: 'department-1',
  requestOrigin: 'external',
  financialImpact: 'within_budget',
  tripCategory: 'learner_transport',
};

function candidate(
  id: string,
  values: Partial<WorkflowRouteCandidate> = {},
): WorkflowRouteCandidate {
  return {
    id,
    version: 1,
    tripScope: 'regional',
    regionId: null,
    officeId: null,
    departmentId: null,
    requestOrigin: null,
    financialImpact: null,
    tripCategory: null,
    ...values,
  };
}

describe('conditional workflow route resolver', () => {
  it('keeps legacy null conditions as wildcards', () => {
    const result = resolveWorkflowRoute([candidate('legacy')], context);
    expect(result).toMatchObject({ status: 'matched', definition: { id: 'legacy' }, specificity: 0 });
  });

  it('selects the most specific matching route', () => {
    const result = resolveWorkflowRoute(
      [
        candidate('fallback'),
        candidate('external', { requestOrigin: 'external' }),
        candidate('external-budget', {
          requestOrigin: 'external',
          financialImpact: 'within_budget',
        }),
      ],
      context,
    );
    expect(result).toMatchObject({
      status: 'matched',
      definition: { id: 'external-budget' },
      specificity: 2,
    });
  });

  it('rejects equally specific overlapping routes instead of guessing', () => {
    const result = resolveWorkflowRoute(
      [
        candidate('external', { requestOrigin: 'external' }),
        candidate('office', { officeId: 'office-1' }),
      ],
      context,
    );
    expect(result).toMatchObject({ status: 'ambiguous', specificity: 1 });
  });

  it('does not match a different request origin', () => {
    const result = resolveWorkflowRoute(
      [candidate('internal', { requestOrigin: 'internal' })],
      context,
    );
    expect(result).toEqual({ status: 'no_match' });
  });

  it('derives programme origin before requester type for legacy callers', () => {
    expect(normaliseRequestOrigin('external', true)).toBe('programme');
    expect(normaliseRequestOrigin('external', false)).toBe('external');
  });

  it('detects equal-precedence overlaps before publication', () => {
    expect(
      workflowRoutesAreAmbiguous(
        candidate('external', { requestOrigin: 'external' }),
        candidate('office', { officeId: 'office-1' }),
      ),
    ).toBe(true);
    expect(
      workflowRoutesAreAmbiguous(
        candidate('external', { requestOrigin: 'external' }),
        candidate('internal', { requestOrigin: 'internal' }),
      ),
    ).toBe(false);
    expect(
      workflowRoutesAreAmbiguous(
        candidate('fallback'),
        candidate('external', { requestOrigin: 'external' }),
      ),
    ).toBe(false);
  });
});
