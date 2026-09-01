import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0110_active_trip_evidence_claim_guard.sql'),
  'utf8',
);
const uploadRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/upload/route.ts'),
  'utf8',
);
const dedupRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/storage/check-dup/route.ts'),
  'utf8',
);
const operationsRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);

describe('active-trip evidence claim contract', () => {
  it('stages incident evidence under tenant and uploader identity with server hashes', () => {
    expect(uploadRouteSource).toContain("category === 'inspection' || category === 'trip-incident'");
    expect(uploadRouteSource).toContain('INSERT INTO active_trip_evidence_uploads');
    expect(uploadRouteSource).toContain("'trip_incident'");
    expect(uploadRouteSource).toContain('${session.tenantId}::uuid');
    expect(uploadRouteSource).toContain('${session.user.id}');
    expect(uploadRouteSource).toContain('${sha256}');
    expect(uploadRouteSource).toContain('await deleteFile(result.key)');
  });

  it('never reuses an existing incident object key through deduplication', () => {
    expect(dedupRouteSource).toContain("if (category === 'trip-incident')");
    expect(dedupRouteSource).toContain('data: { keys: [], existing: false }');
    expect(uploadRouteSource).toContain('buildKey(file.name, path, tenantPrefix)');
  });

  it('claims each incident key once and derives attachment hashes from staging', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS active_trip_evidence_uploads');
    expect(migrationSource).toContain('uq_active_trip_evidence_uploads_tenant_key');
    expect(migrationSource).toContain('claim_trip_incident_evidence');
    expect(migrationSource).toContain('BEFORE INSERT ON trip_incidents');
    expect(migrationSource).toContain("evidence_kind = 'trip_incident'");
    expect(migrationSource).toContain('uploaded_by_user_id = NEW.reported_by_user_id');
    expect(migrationSource).toContain('FOR UPDATE;');
    expect(migrationSource).toContain('claimed_entity_id = NEW.id');
    expect(migrationSource).toContain('claimed_sync_id = NEW.client_sync_id');
    expect(migrationSource).toContain('NEW.attachment_hashes := v_hashes');
  });

  it('preserves same-clientSyncId replay while rejecting cross-operation evidence reuse', () => {
    expect(migrationSource).toContain('v_claimed_sync_id IS NOT DISTINCT FROM NEW.client_sync_id');
    expect(migrationSource).toContain('incident attachment evidence was already claimed');
    expect(migrationSource).toContain('duplicate incident attachment evidence is not allowed');
    expect(operationsRouteSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(operationsRouteSource).toContain('{ status: 409 }');
  });

  it('blocks the dormant progress attachment field until it has staged evidence support', () => {
    expect(migrationSource).toContain('reject_unstaged_trip_progress_attachment');
    expect(migrationSource).toContain('BEFORE INSERT OR UPDATE OF attachment_key ON trip_progress_entries');
    expect(migrationSource).toContain('progress attachments require an authoritative staged upload path');
  });

  it('requires trip expense receipt keys to consume exactly one same-uploader staging row', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION consume_operational_expense_receipt_staging()');
    expect(migrationSource).toContain('staged.uploaded_by_user_id = NEW.entered_by_user_id');
    expect(migrationSource).toContain('GET DIAGNOSTICS v_claimed = ROW_COUNT');
    expect(migrationSource).toContain('IF v_claimed <> 1 THEN');
    expect(migrationSource).toContain('trip_expense_lifecycle_conflict: receipt evidence was not staged');
  });
});
