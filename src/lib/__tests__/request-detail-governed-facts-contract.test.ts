import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detail = readFileSync('src/app/(dashboard)/dashboard/requests/[id]/page.tsx', 'utf8');

describe('transport request detail governed facts contract', () => {
  it('loads the governed trip and budget classification recorded on the request', () => {
    for (const field of [
      'requestOrigin: transportRequests.requestOrigin',
      'financialImpact: transportRequests.financialImpact',
      'tripCategory: transportRequests.tripCategory',
      'estimatedCost: transportRequests.estimatedCost',
      'currency: transportRequests.currency',
      'costCentre: transportRequests.costCentre',
      'fundingSource: transportRequests.fundingSource',
      'budgetReference: transportRequests.budgetReference',
      'driverPreference: transportRequests.driverPreference',
    ]) {
      expect(detail).toContain(field);
    }
    expect(detail).toContain('Trip & Budget Classification');
    expect(detail).toContain('Estimated cost');
    expect(detail).toContain('Budget reference');
    expect(detail).toContain('Driver preference');
  });

  it('loads and renders every goods/equipment child row', () => {
    expect(detail).toContain('requestGoodsEquipment,');
    expect(detail).toContain('.from(requestGoodsEquipment)');
    expect(detail).toContain('eq(requestGoodsEquipment.requestId, id)');
    expect(detail).toContain('Goods & Equipment ({goodsEquipment.length})');
    expect(detail).toContain('goodsEquipment.map((item) =>');
  });

  it('preserves richer passenger context needed for review', () => {
    for (const field of [
      'externalIdReference: requestPassengers.externalIdReference',
      'externalOrganisation: requestPassengers.externalOrganisation',
      'externalPhone: requestPassengers.externalPhone',
      'externalEmail: requestPassengers.externalEmail',
      'travellerRole: requestPassengers.travellerRole',
      'reasonForTravel: requestPassengers.reasonForTravel',
    ]) {
      expect(detail).toContain(field);
    }
    expect(detail).toContain('Travel reason: {p.reasonForTravel}');
  });

  it('keeps the primary request lookup tenant-scoped', () => {
    expect(detail).toContain('eq(transportRequests.tenantId, tenantId)');
  });
});
