import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const createSource = readFileSync(resolve(process.cwd(), 'src/app/api/fleet/route.ts'), 'utf8');
const importSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/import/route.ts'),
  'utf8',
);

describe('initial vehicle lifecycle evidence contract', () => {
  it('records initial status and non-zero odometer atomically for interactive creation', () => {
    expect(createSource).toContain('const vehicle = await db.transaction(async (tx) => {');
    expect(createSource).toContain('await tx.insert(vehicleStatusEvents).values({');
    expect(createSource).toContain('previousStatus: null');
    expect(createSource).toContain("reason: 'Initial fleet registration'");
    expect(createSource).toContain('if (currentOdometer > 0)');
    expect(createSource).toContain('await tx.insert(vehicleOdometerEvents).values({');
  });

  it('records initial status and non-zero odometer in the committed import transaction', () => {
    expect(importSource).toContain("const initialStatus = importedStatus || 'available';");
    expect(importSource).toContain('const initialOdometer = importedOdometer ?? 0;');
    expect(importSource).toContain("reason: 'Initial fleet registration via bulk import'");
    expect(importSource).toContain("referenceEntityType: 'fleet_import'");
    expect(importSource).toContain('if (initialOdometer > 0)');
    expect(importSource).toContain('isCommitted: true');
  });
});
