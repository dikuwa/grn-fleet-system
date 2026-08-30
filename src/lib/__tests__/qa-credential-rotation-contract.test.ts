import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/scripts/rotate-qa-credentials.ts', 'utf8');

describe('QA credential rotation guardrails', () => {
  it('is allowlisted to the seeded QA identities', () => {
    expect(source).toContain("'requester@kavangoeast.test'");
    expect(source).toContain("'driver@kavangoeast.test'");
    expect(source).toContain("'platform.admin@grnfleet.test'");
    expect(source).toContain("inArray(user.email, [...QA_EMAILS])");
  });

  it('defaults to dry run and refuses unsafe passwords', () => {
    expect(source).toContain("const execute = process.argv.includes('--execute')");
    expect(source).toContain("password === 'changeme'");
    expect(source).toContain('password.length < 16');
    expect(source).toContain('DRY RUN ONLY');
  });

  it('requires complete QA account matching before rotation', () => {
    expect(source).toContain('qaAccounts.length !== qaUsers.length');
    expect(source).toContain('refusing a partial credential rotation');
    expect(source).toContain('db.transaction');
  });

  it('revokes existing QA sessions in the same transaction', () => {
    expect(source).toContain('tx.delete(session)');
    expect(source).toContain('inArray(session.userId, qaUserIds)');
  });

  it('never prints the replacement password', () => {
    expect(source).toContain('Password value was not logged.');
    expect(source).not.toContain('console.log(password)');
  });
});
