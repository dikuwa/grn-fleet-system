import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0109_inspection_evidence_claim_guard.sql'),
  'utf8',
);
const uploadRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/upload/route.ts'),
  'utf8',
);
const inspectionRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);
const inspectionServiceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/inspection-service.ts'),
  'utf8',
);

describe('official inspection evidence claim contract', () => {
  it('keeps the existing tenant namespace validation at the service boundary', () => {
    expect(inspectionServiceSource).toContain('const expectedPrefix = `tenant/${tenantId}/inspections/`;');
    expect(inspectionServiceSource).toContain("fail('Inspection evidence contains an invalid storage key', 422)");
  });

  it('stages each inspection upload as unique single-use evidence instead of deduplicating it', () => {
    expect(uploadRouteSource).toContain("if (category === 'inspection') {");
    expect(uploadRouteSource).toContain('buildKey(file.name, path, tenantPrefix)');
    expect(uploadRouteSource).toContain('INSERT INTO inspection_evidence_uploads');
    expect(uploadRouteSource).toContain('${session.tenantId}::uuid');
    expect(uploadRouteSource).toContain('${session.user.id}');
    expect(uploadRouteSource).toContain('await deleteFile(result.key)');
  });

  it('records tenant, uploader, object identity and claim state authoritatively', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS inspection_evidence_uploads');
    expect(migrationSource).toContain('tenant_id uuid NOT NULL REFERENCES tenants(id)');
    expect(migrationSource).toContain('file_key text NOT NULL UNIQUE');
    expect(migrationSource).toContain('uploaded_by_user_id text NOT NULL');
    expect(migrationSource).toContain(
      'claimed_inspection_id uuid REFERENCES vehicle_inspections(id) ON DELETE CASCADE',
    );
    expect(migrationSource).toContain('ck_inspection_evidence_claim_pair');
  });

  it('claims evidence inside the official inspection transaction and rejects fabricated or reused keys', () => {
    expect(migrationSource).toContain('claim_official_inspection_evidence');
    expect(migrationSource).toContain('BEFORE INSERT ON inspection_photos');
    expect(migrationSource).toContain('FOR UPDATE;');
    expect(migrationSource).toContain('ieu.tenant_id = v_tenant_id');
    expect(migrationSource).toContain('ieu.uploaded_by_user_id = v_inspector_user_id');
    expect(migrationSource).toContain('ieu.claimed_inspection_id IS NULL');
    expect(migrationSource).toContain('inspection_evidence_claim_conflict');
    expect(migrationSource).toContain("ERRCODE = '23514'");
  });

  it('returns a recoverable conflict when submitted evidence is stale or already claimed', () => {
    expect(inspectionRouteSource).toContain("message.includes('inspection_evidence_claim_conflict')");
    expect(inspectionRouteSource).toContain('Re-upload the affected evidence and submit the inspection again.');
    expect(inspectionRouteSource).toContain('{ status: 409 }');
  });
});
