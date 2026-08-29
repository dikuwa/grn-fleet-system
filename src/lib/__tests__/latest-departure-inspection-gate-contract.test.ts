import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/trip-release-gate.ts', 'utf8');

function departureInspectionBlock() {
  const start = source.indexOf('const [departureInspection] = await db');
  const end = source.indexOf('if (!departureInspectionPassed)', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('canonical physical-Issue departure inspection gate', () => {
  it('evaluates the latest departure inspection rather than searching for any historical pass', () => {
    const block = departureInspectionBlock();

    expect(block).toContain('status: vehicleInspections.status');
    expect(block).toContain('overallPass: vehicleInspections.overallPass');
    expect(block).toContain("eq(vehicleInspections.type, 'departure')");
    expect(block).toContain(
      '.orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))',
    );

    // Filtering to only passing rows would let an older pass mask a newer
    // failed/incomplete inspection. Select the latest row first instead.
    expect(block).not.toContain('eq(vehicleInspections.status');
    expect(block).not.toContain('eq(vehicleInspections.overallPass');
    expect(block).toContain("departureInspection?.status === 'completed'");
    expect(block).toContain('departureInspection.overallPass === true');
    expect(block).toContain('checks.departureInspectionPassed = departureInspectionPassed');
  });
});
