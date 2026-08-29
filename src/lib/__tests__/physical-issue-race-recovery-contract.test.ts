import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/app/(dashboard)/dashboard/trips/components/TripActions.tsx',
  'utf8',
);

describe('physical Issue race recovery', () => {
  it('preserves canonical blocker detail and refreshes readiness after a 409', () => {
    expect(source).toContain('interface IssueFailureResponse');
    expect(source).toContain('blockers?: Array<{ code?: string; message?: string }>');
    expect(source).toContain("errData.actionUrl.startsWith('/dashboard/')");
    expect(source).toContain('const blockerMessage = errData.blockers?.find(');
    expect(source).toContain('if (res.status === 409)');
    expect(source).toContain('await refreshReadiness();');
    expect(source).toContain("throw new Error(blockerMessage || errData.error || 'Failed to issue vehicle')");
  });

  it('shows an explicit recovery action only when a verified dashboard URL is present', () => {
    expect(source).toContain('const [issueRecoveryUrl, setIssueRecoveryUrl] = useState<string | null>(null)');
    expect(source).toContain('{issueRecoveryUrl && (');
    expect(source).toContain('href={issueRecoveryUrl}');
    expect(source).toContain('Open blocking record');
  });
});
