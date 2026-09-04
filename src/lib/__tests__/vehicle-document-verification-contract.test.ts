import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const listRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/documents/route.ts'),
  'utf8',
);
const verifyRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/documents/[documentId]/verify/route.ts'),
  'utf8',
);
const reviewUiSource = readFileSync(
  resolve(process.cwd(), 'src/components/fleet/vehicle-document-upload.tsx'),
  'utf8',
);

describe('vehicle document human verification contract', () => {
  it('limits the pending review feed to tenant-scoped unverified vehicle documents', () => {
    expect(listRouteSource).toContain("requireDashboardAction(session, '/dashboard/fleet', 'update')");
    expect(listRouteSource).toContain('requirePermission(session, Permissions.VEHICLE_UPDATE)');
    expect(listRouteSource).toContain('eq(vehicles.tenantId, session.tenantId)');
    expect(listRouteSource).toContain('eq(vehicleDocuments.isVerified, false)');
    expect(listRouteSource).toContain('updatedAt: vehicleDocuments.updatedAt');
  });

  it('claims the exact unverified document revision before granting trust', () => {
    expect(verifyRouteSource).toContain("const VEHICLE_DOCUMENT_VERIFY_CONFLICT = 'vehicle_document_verify_conflict';");
    expect(verifyRouteSource).toContain('eq(vehicleDocuments.isVerified, false)');
    expect(verifyRouteSource).toContain("date_trunc('milliseconds', ${vehicleDocuments.updatedAt})");
    expect(verifyRouteSource).toContain('${parsedExpectedUpdatedAt.toISOString()}::timestamptz');
    expect(verifyRouteSource).toContain('if (!updated) throw new Error(VEHICLE_DOCUMENT_VERIFY_CONFLICT);');
    expect(verifyRouteSource).toContain("{ error: 'This document changed while it was being reviewed. Refresh and review the latest version.' }");
    expect(verifyRouteSource).toContain('{ status: 409 }');
  });

  it('writes verification and its audit evidence in one transaction', () => {
    const transactionStart = verifyRouteSource.indexOf('await db.transaction(async (tx) => {');
    const updateStart = verifyRouteSource.indexOf('.update(vehicleDocuments)', transactionStart);
    const auditStart = verifyRouteSource.indexOf('await recordAuditEvent(', updateStart);
    const returnStart = verifyRouteSource.indexOf('return updated;', auditStart);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(updateStart).toBeGreaterThan(transactionStart);
    expect(auditStart).toBeGreaterThan(updateStart);
    expect(returnStart).toBeGreaterThan(auditStart);
    expect(verifyRouteSource).toContain("eventType: 'vehicle_document_verified'");
    expect(verifyRouteSource).toContain("action: 'vehicle.document.verify'");
    expect(verifyRouteSource).toContain('updatedAt: current.updatedAt.toISOString()');
  });

  it('exposes a deliberate human review control beside vehicle document upload', () => {
    expect(reviewUiSource).toContain('Review Documents');
    expect(reviewUiSource).toContain('Open each uploaded file and verify it only after');
    expect(reviewUiSource).toContain('/api/fleet/${vehicleId}/documents/${document.id}/verify');
    expect(reviewUiSource).toContain('expectedUpdatedAt: document.updatedAt');
    expect(reviewUiSource).toContain('router.refresh()');
  });
});
