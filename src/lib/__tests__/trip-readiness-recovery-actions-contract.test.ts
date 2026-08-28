import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/app/(dashboard)/dashboard/trips/components/ReleaseReadinessCheck.tsx',
  'utf8',
);

describe('trip readiness recovery actions contract', () => {
  it('maps verified unresolved readiness gates to existing dashboard recovery routes', () => {
    expect(source).toContain("case 'request_approvals':");
    expect(source).toContain("href: '/dashboard/approvals'");
    expect(source).toContain("href: '/dashboard/allocations'");
    expect(source).toContain("href: '/dashboard/drivers'");
    expect(source).toContain("href: '/dashboard/fleet'");
    expect(source).toContain("href: `/dashboard/trips/${tripId}/authority`");
    expect(source).toContain("href: '/dashboard/inspections'");
  });

  it('does not offer recovery navigation for gates that have already passed', () => {
    expect(source).toContain(
      "gate.status === 'pass' ? null : resolveGateRecoveryAction(gate.key, tripId)",
    );
  });

  it('keeps the operator-facing recovery labels explicit', () => {
    expect(source).toContain("label: 'Open approvals'");
    expect(source).toContain("label: 'Open drivers'");
    expect(source).toContain("label: 'Open fleet'");
    expect(source).toContain("label: 'Open Trip Authority'");
    expect(source).toContain("label: 'Open inspections'");
  });
});
