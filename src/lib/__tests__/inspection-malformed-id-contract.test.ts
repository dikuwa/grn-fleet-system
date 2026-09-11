import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/inspections/route.ts'), 'utf8');

describe('inspection malformed-id guards', () => {
  it('rejects malformed vehicle or trip ids independently before UUID-backed database work', () => {
    const idsIndex = source.indexOf("const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';");
    const guardIndex = source.indexOf('(vehicleId && !UUID_PATTERN.test(vehicleId))');
    const authorityQueryIndex = source.indexOf('const [authority] = await db', guardIndex);
    const serviceIndex = source.indexOf('const result = await completeOfficialInspection', guardIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(idsIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(idsIndex);
    expect(source.slice(guardIndex, authorityQueryIndex)).toContain(
      '(tripId && !UUID_PATTERN.test(tripId))',
    );
    expect(source.slice(guardIndex, authorityQueryIndex)).toContain(
      "{ error: 'Trip or vehicle not found' }",
    );
    expect(source.slice(guardIndex, authorityQueryIndex)).toContain('{ status: 404 }');
    expect(authorityQueryIndex).toBeGreaterThan(guardIndex);
    expect(serviceIndex).toBeGreaterThan(guardIndex);
  });

  it('does not require both identifiers to be present before validating either one', () => {
    expect(source).not.toContain(
      'vehicleId &&\n      tripId &&\n      (!UUID_PATTERN.test(vehicleId) || !UUID_PATTERN.test(tripId))',
    );
  });
});
