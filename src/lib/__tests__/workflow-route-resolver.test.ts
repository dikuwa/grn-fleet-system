import { describe, expect, it } from 'vitest';

import {
  normaliseRequestOrigin,
  resolveWorkflowRoute,
  type WorkflowRouteCandidate,
  type WorkflowRouteContext,
} from '@/lib/workflow-route-resolver';

describe('normaliseRequestOrigin', () => {
  it('preserves an internal origin even if a programme is linked later', () => {
    expect(normaliseRequestOrigin('internal', true)).toBe('internal');
  });

  it('preserves an external origin even if a programme is linked later', () => {
    expect(normaliseRequestOrigin('external', true)).toBe('external');
  });

  it('preserves an explicitly programme-originated request', () => {
    expect(normaliseRequestOrigin('programme', false)).toBe('programme');
  });

  it('uses programme membership only as a legacy fallback when origin is missing', () => {
    expect(normaliseRequestOrigin(null, true)).toBe('programme');
    expect(normaliseRequestOrigin(undefined, true)).toBe('programme');
  });

  it('falls back to internal when no valid frozen origin or programme exists', () => {
    expect(normaliseRequestOrigin('unknown', false)).toBe('internal');
  });
});

describe('resolveWorkflowRoute request-origin isolation', () => {
  const context: WorkflowRouteContext = {
    tripScope: 'regional',
    regionId: null,
    officeId: null,
    departmentId: null,
    requestOrigin: 'internal',
    financialImpact: 'none',
    tripCategory: 'general',
  };

  const baseCandidate = {
    version: 1,
    tripScope: 'regional',
    regionId: null,
    officeId: null,
    departmentId: null,
    financialImpact: null,
    tripCategory: null,
  } satisfies Omit<WorkflowRouteCandidate, 'id' | 'requestOrigin'>;

  it('keeps programme and internal routes distinct', () => {
    const candidates: WorkflowRouteCandidate[] = [
      { ...baseCandidate, id: 'internal-route', requestOrigin: 'internal' },
      { ...baseCandidate, id: 'programme-route', requestOrigin: 'programme' },
    ];

    const result = resolveWorkflowRoute(candidates, context);

    expect(result.status).toBe('matched');
    if (result.status === 'matched') expect(result.definition.id).toBe('internal-route');
  });
});
