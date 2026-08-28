import { describe, expect, it } from 'vitest';
import {
  parseRequestRoutingCorrection,
  requestRoutingChanged,
  type ExistingRequestRouting,
} from './request-routing-correction';

const existing: ExistingRequestRouting = {
  requesterType: 'internal',
  requestOrigin: 'internal',
  programmeId: null,
  financialImpact: 'none',
  tripCategory: 'general',
  estimatedCost: null,
  currency: 'NAD',
  costCentre: null,
  fundingSource: null,
  budgetReference: null,
};

describe('request routing correction', () => {
  it('normalises corrected budget fields for route selection', () => {
    const result = parseRequestRoutingCorrection(
      {
        financialImpact: 'within_budget',
        tripCategory: 'learner_transport',
        estimatedCost: '15000',
        costCentre: 'EDU-101',
        fundingSource: 'Directorate travel budget',
        budgetReference: 'BUD-2026-04',
      },
      existing,
    );

    expect(result).toEqual({
      ok: true,
      fields: {
        requestOrigin: 'internal',
        financialImpact: 'within_budget',
        tripCategory: 'learner_transport',
        estimatedCost: '15000.00',
        currency: 'NAD',
        costCentre: 'EDU-101',
        fundingSource: 'Directorate travel budget',
        budgetReference: 'BUD-2026-04',
      },
    });
    if (result.ok) expect(requestRoutingChanged(existing, result.fields)).toBe(true);
  });

  it('clears stale budget metadata when financial impact becomes none', () => {
    const result = parseRequestRoutingCorrection(
      {
        financialImpact: 'none',
        tripCategory: 'general',
        estimatedCost: '9000',
        costCentre: 'OLD',
        fundingSource: 'OLD',
        budgetReference: 'OLD',
      },
      { ...existing, financialImpact: 'within_budget', estimatedCost: '9000.00' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields).toMatchObject({
        financialImpact: 'none',
        estimatedCost: null,
        costCentre: null,
        fundingSource: null,
        budgetReference: null,
      });
    }
  });

  it('keeps the frozen origin when a programme is linked later', () => {
    const result = parseRequestRoutingCorrection(
      { financialImpact: 'additional_funding', tripCategory: 'outreach' },
      { ...existing, programmeId: 'programme-1' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields.requestOrigin).toBe('internal');
  });
});
