import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/approvals/approval-action-panel.tsx'),
  'utf8',
);

describe('approval readiness error contract', () => {
  it('preserves API blocker messages in the officer-facing decision error', () => {
    expect(source).toContain('function approvalActionErrorMessage');
    expect(source).toContain("Array.isArray(payload.blockers)");
    expect(source).toContain("blockers.join(' · ')");
    expect(source).toContain('throw new Error(approvalActionErrorMessage(result))');
  });

  it('offers a safe dashboard link to the record that must be corrected', () => {
    expect(source).toContain("result.actionUrl.startsWith('/dashboard/')");
    expect(source).toContain('setErrorActionUrl');
    expect(source).toContain('Open blocking record');
  });
});
