import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detail = readFileSync('src/app/(dashboard)/dashboard/requests/[id]/page.tsx', 'utf8');
const externalDetail = readFileSync(
  'src/app/(dashboard)/dashboard/requests/external/[id]/page.tsx',
  'utf8',
);

const GOVERNED_FIELDS = [
  'requestOrigin: transportRequests.requestOrigin',
  'financialImpact: transportRequests.financialImpact',
  'tripCategory: transportRequests.tripCategory',
  'estimatedCost: transportRequests.estimatedCost',
  'currency: transportRequests.currency',
  'costCentre: transportRequests.costCentre',
  'fundingSource: transportRequests.fundingSource',
  'budgetReference: transportRequests.budgetReference',
  'driverPreference: transportRequests.driverPreference',
];

describe('transport request detail governed facts contract', () => {
  it('loads the governed trip and budget classification on internal detail', () => {
    for (const field of GOVERNED_FIELDS) expect(detail).toContain(field);
    expect(detail).toContain('Trip & Budget Classification');
    expect(detail).toContain('Estimated cost');
    expect(detail).toContain('Budget reference');
    expect(detail).toContain('Driver preference');
  });

  it('loads and renders every goods/equipment child row on internal detail', () => {
    expect(detail).toContain('requestGoodsEquipment,');
    expect(detail).toContain('.from(requestGoodsEquipment)');
    expect(detail).toContain('eq(requestGoodsEquipment.requestId, id)');
    expect(detail).toContain('Goods & Equipment ({goodsEquipment.length})');
    expect(detail).toContain('goodsEquipment.map((item) =>');
  });

  it('preserves non-sensitive passenger review context while gating PII', () => {
    expect(detail).toContain('externalOrganisation: requestPassengers.externalOrganisation');
    expect(detail).toContain('travellerRole: requestPassengers.travellerRole');
    expect(detail).toContain('reasonForTravel: requestPassengers.reasonForTravel');
    expect(detail).toContain("const canViewPassengerPII = access.recordScope === 'tenant' || isOwner;");
    expect(detail).toContain('canViewPassengerPII ? p.externalPhone : null');
    expect(detail).toContain('canViewPassengerPII ? p.externalEmail : null');
    expect(detail).toContain('canViewPassengerPII && p.externalIdReference');
    expect(detail).toContain('Travel reason: {p.reasonForTravel}');
  });

  it('keeps the primary internal request lookup tenant-scoped', () => {
    expect(detail).toContain('eq(transportRequests.tenantId, tenantId)');
  });

  it('renders governed fields and goods/equipment on external request detail too', () => {
    for (const field of GOVERNED_FIELDS) expect(externalDetail).toContain(field);
    expect(externalDetail).toContain('requestGoodsEquipment,');
    expect(externalDetail).toContain('.from(requestGoodsEquipment)');
    expect(externalDetail).toContain('eq(requestGoodsEquipment.requestId, id)');
    expect(externalDetail).toContain('Trip & Budget Classification');
    expect(externalDetail).toContain('Goods & Equipment ({goodsEquipment.length})');
  });

  it('keeps the external request lookup tenant-scoped', () => {
    expect(externalDetail).toContain('eq(transportRequests.tenantId, tenantId)');
  });
});
