import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/legal-policy/route.ts'),
  'utf8',
);

describe('legal policy mutation integrity contract', () => {
  it('preserves body validation before malformed-id not-found handling', () => {
    const idRequired = source.indexOf('Entry id is required.');
    const parsed = source.indexOf('if (!parsed.ok)', idRequired);
    const guard = source.indexOf('if (!UUID_PATTERN.test(id))', parsed);
    const db = source.indexOf('const db = getDb()', guard);

    expect(idRequired).toBeGreaterThan(-1);
    expect(parsed).toBeGreaterThan(idRequired);
    expect(guard).toBeGreaterThan(parsed);
    expect(db).toBeGreaterThan(guard);
  });

  it('uses the existing register-entry 404 before UUID-backed access', () => {
    const guard = source.indexOf('if (!UUID_PATTERN.test(id))');
    const notFound = source.indexOf('Register entry not found.', guard);
    const lookup = source.indexOf('eq(legalPolicyRegister.id, id)', guard);

    expect(notFound).toBeGreaterThan(guard);
    expect(lookup).toBeGreaterThan(notFound);
  });

  it('normalizes the reviewed revision to milliseconds before update claim', () => {
    const helper = source.indexOf('function legalPolicyRevisionMatches');
    const normalized = source.indexOf("date_trunc('milliseconds'", helper);
    const claim = source.indexOf('legalPolicyRevisionMatches(before.updatedAt)', normalized);

    expect(helper).toBeGreaterThan(-1);
    expect(normalized).toBeGreaterThan(helper);
    expect(claim).toBeGreaterThan(normalized);
  });

  it('returns controlled conflict before audit when the revision claim loses', () => {
    const returning = source.indexOf('.returning();', source.indexOf('legalPolicyRevisionMatches(before.updatedAt)'));
    const lost = source.indexOf('if (!updated)', returning);
    const conflict = source.indexOf('This register entry changed while the update was being prepared', lost);
    const audit = source.indexOf('await recordAuditEvent({', conflict);

    expect(lost).toBeGreaterThan(returning);
    expect(conflict).toBeGreaterThan(lost);
    expect(audit).toBeGreaterThan(conflict);
  });
});
