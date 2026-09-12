import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection evidence generic file access', () => {
  it('allows preview only for the uploader while inspection evidence is still unclaimed', () => {
    const route = source('src/app/api/files/route.ts');

    expect(route).toContain("tenantRelativeKey.startsWith('inspections/')");
    expect(route).toContain('FROM inspection_evidence_uploads ieu');
    expect(route).toContain('ieu.tenant_id = ${session.tenantId}::uuid');
    expect(route).toContain('ieu.file_key = ${key}');
    expect(route).toContain('ieu.uploaded_by_user_id = ${session.user.id}');
    expect(route).toContain('ieu.claimed_inspection_id IS NULL');
    expect(route).toContain('canPreviewUnclaimedUpload');
  });

  it('requires claimed photos to remain inside the caller inspection record scope', () => {
    const route = source('src/app/api/files/route.ts');

    expect(route).toContain("requireDashboardAction(\n          session,\n          '/dashboard/inspections',\n          'view',");
    expect(route).toContain('requirePermission(session, Permissions.INSPECTION_VIEW)');
    expect(route).toContain("resolveDashboardAccess('/dashboard/inspections', roleNames)");
    expect(route).toContain('.innerJoin(vehicleInspections, eq(inspectionPhotos.inspectionId, vehicleInspections.id))');
    expect(route).toContain('eq(inspectionPhotos.fileKey, key)');
    expect(route).toContain('inspectionScopeCondition({');
    expect(route).toContain("recordScope: access.recordScope ?? 'assigned'");
    expect(route).toContain('this file is not available in your inspection scope');
  });
});
