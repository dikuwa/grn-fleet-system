import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/requests/[id]/transport-review-correction/route.ts'),
  'utf8',
);
const panelSource = readFileSync(
  resolve(process.cwd(), 'src/components/approvals/transport-request-corrections.tsx'),
  'utf8',
);

describe('Transport Review correction contract', () => {
  it('is restricted to the active Transport Review actor', () => {
    expect(routeSource).toContain('Permissions.REQUEST_REVIEW_TRANSPORT');
    expect(routeSource).toContain("detail.currentStep?.actionType !== 'transport_review'");
    expect(routeSource).toContain('!detail.canAct');
    expect(routeSource).toContain("detail.instance.status !== 'active'");
  });

  it('keeps governed routing identity immutable while recording a revision note', () => {
    expect(routeSource).toContain('currentRequest.requestOrigin !== requestContext.requestOrigin');
    expect(routeSource).toContain('tx.insert(requestRevisions)');
    expect(routeSource).toContain("source: 'transport_review'");
    expect(routeSource).toContain('reason,');

    const requestUpdateStart = routeSource.indexOf('.update(transportRequests)');
    const requestUpdateEnd = routeSource.indexOf('.returning({ revision:', requestUpdateStart);
    const requestUpdate = routeSource.slice(requestUpdateStart, requestUpdateEnd);
    expect(requestUpdate).not.toContain('requestOrigin:');
    expect(requestUpdate).not.toContain('financialImpact:');
    expect(requestUpdate).not.toContain('programmeId:');
  });

  it('revalidates allocation availability and driver eligibility before moving the schedule', () => {
    expect(routeSource).toContain('The assigned vehicle is already allocated during the corrected schedule.');
    expect(routeSource).toContain('The assigned driver is already allocated during the corrected schedule.');
    expect(routeSource).toContain('calculateDriverCompliance');
    expect(routeSource).toContain('namibiaLicenceClassCovers');
    expect(routeSource).toContain('.update(vehicleAllocations)');
  });

  it('uses half-open overlap checks so adjacent allocations remain valid', () => {
    expect(routeSource).toContain('lt(vehicleAllocations.startAt, nextEnd)');
    expect(routeSource).toContain('gt(vehicleAllocations.endAt, nextStart)');
    expect(routeSource).toContain('ne(vehicleAllocations.id, allocation.id)');
  });

  it('derives the corrected allocation window from every submitted activity', () => {
    expect(routeSource).toContain('activity.startDate < min ? activity.startDate : min');
    expect(routeSource).toContain('activity.endDate > max ? activity.endDate : max');
    expect(routeSource).toContain('const scheduleChanged = activities.some');
  });

  it('persists a schedule correction through allocation, revision, response, and audit metadata', () => {
    expect(routeSource).toContain('if (scheduleChanged && allocation && nextStart && nextEnd)');
    expect(routeSource).toContain('startAt: nextStart');
    expect(routeSource).toContain('endAt: nextEnd');
    expect(routeSource).toContain('version: allocation.version + 1');
    expect(routeSource).toContain('eq(vehicleAllocations.version, allocation.version)');
    expect(routeSource).toContain('scheduleChanged,\n          routeChanged,\n        },\n        reason,');
    expect(routeSource).toContain("action: 'request.transport_review_corrected'");
    expect(routeSource).toContain('success: true');
    expect(routeSource).toContain('changed: true');
    expect(routeSource).toContain('revision: result.revision');
    expect(routeSource).toContain('scheduleChanged: result.scheduleChanged');
  });

  it('locks corrections at acknowledgement, external acceptance, authority, physical-issue, or departure boundaries', () => {
    expect(routeSource).toContain('tripAuthorities');
    expect(routeSource).toContain("trip.status !== 'pending'");
    expect(routeSource).toContain('trip.issuedAt');
    expect(routeSource).toContain('trip.driverAcknowledgedAt');
    expect(routeSource).toContain("eq(externalDriverAssignments.state, 'accepted')");
    expect(routeSource).toContain('externalAcceptanceLocked');
    expect(routeSource).toContain("authority.status !== 'draft'");
    expect(routeSource).toContain('authority.issuedAt');
    expect(routeSource).toContain('authority.authorisedAt');
    expect(routeSource).toContain('authority.acceptedAt');
    expect(routeSource).toContain('if (tripLocked || authorityLocked || externalAcceptanceLocked)');
    expect(routeSource).toContain(
      'Request details are locked after driver acknowledgement or external driver acceptance, authority authorisation, physical issue, or trip departure.',
    );
  });

  it('requires a human-readable note from the Transport Review UI', () => {
    expect(panelSource).toContain('Correction note');
    expect(panelSource).toContain('transport-review-correction');
    expect(panelSource).toContain('This note is stored with the request revision and audit record.');
  });
});
