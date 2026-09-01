import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const correctionRoute = readFileSync(
  'src/app/api/requests/[id]/transport-review-correction/route.ts',
  'utf8',
);
const correctionEditor = readFileSync(
  'src/components/approvals/transport-request-corrections.tsx',
  'utf8',
);
const actionPage = readFileSync(
  'src/app/(dashboard)/dashboard/approvals/[id]/action/page.tsx',
  'utf8',
);

describe('Transport Review journey-route correction contract', () => {
  it('passes governed request routes into the correction editor', () => {
    expect(actionPage).toContain('routes={detail.routes.map((route) => ({');
    expect(actionPage).toContain('totalKilometres: route.totalKilometres');
    expect(actionPage).toContain('isVerified: route.isVerified');
  });

  it('exposes origin, destination and total kilometres without allowing route add/remove', () => {
    expect(correctionEditor).toContain('Journey routes');
    expect(correctionEditor).toContain("updateRoute(route.id, 'originName'");
    expect(correctionEditor).toContain("updateRoute(route.id, 'destinationName'");
    expect(correctionEditor).toContain("updateRoute(route.id, 'totalKilometres'");
    expect(correctionEditor).toContain('routes: draftRoutes.map((route) => ({');
    expect(correctionEditor).not.toContain('addRoute');
    expect(correctionEditor).not.toContain('removeRoute');
  });

  it('requires the submitted route identities to match the governed request', () => {
    expect(correctionRoute).toContain('routes.length !== existingRoutes.length');
    expect(correctionRoute).toContain('!existingRouteMap.has(route.id)');
    expect(correctionRoute).toContain(
      'Transport Review may correct existing journey routes but cannot add or remove them.',
    );
  });

  it('invalidates mapping metadata only for routes that actually changed', () => {
    expect(correctionRoute).toContain('if (!changed) continue;');
    expect(correctionRoute).toContain('originPlaceId: null');
    expect(correctionRoute).toContain('destinationPlaceId: null');
    expect(correctionRoute).toContain('mappedDistanceKm: null');
    expect(correctionRoute).toContain('mappedDurationMinutes: null');
    expect(correctionRoute).toContain('routePolyline: null');
    expect(correctionRoute).toContain('calculationTimestamp: null');
    expect(correctionRoute).toContain('isVerified: false');
    expect(correctionRoute).toContain('overrideReason: reason');
  });

  it('recalculates authorised kilometres and versions route evidence atomically', () => {
    expect(correctionRoute).toContain(
      'const nextTotalAuthorisedKilometres = Math.max(activityKilometres, routeKilometres) || null;',
    );
    expect(correctionRoute).toContain('totalAuthorisedKilometres: nextTotalAuthorisedKilometres');
    expect(correctionRoute).toContain('routes: { before: beforeRoutes, after: afterRoutes }');
    expect(correctionRoute).toContain('routeChanged,');
    expect(correctionRoute).toContain("source: 'transport_review'");
  });
});
