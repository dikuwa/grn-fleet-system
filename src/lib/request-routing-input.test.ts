import { describe, expect, it } from 'vitest';
import { parseRequestRoutingInput } from './request-routing-input';

describe('request routing input', () => {
  it('keeps NAD canonical and derives programme origin', () => {
    const result = parseRequestRoutingInput(
      { financialImpact: 'within_budget', estimatedCost: 1250.5, tripCategory: 'training' },
      { requesterType: 'internal', hasProgramme: true },
    );
    expect(result).toEqual({
      ok: true,
      fields: expect.objectContaining({
        requestOrigin: 'programme',
        financialImpact: 'within_budget',
        estimatedCost: '1250.50',
        currency: 'NAD',
      }),
    });
  });

  it('rejects invalid financial classifications and amounts', () => {
    expect(parseRequestRoutingInput({ financialImpact: 'maybe' }).ok).toBe(false);
    expect(parseRequestRoutingInput({ estimatedCost: -1 }).ok).toBe(false);
  });
});
