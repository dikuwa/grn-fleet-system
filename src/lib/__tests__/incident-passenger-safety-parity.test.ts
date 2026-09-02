import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const incidentRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/route.ts'),
  'utf8',
);
const operationsRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);
const createIncidentSource = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/create-incident.ts'),
  'utf8',
);

describe('incident passenger safety parity', () => {
  it('accepts explicit passenger safety on the dedicated incident API', () => {
    expect(incidentRouteSource).toContain('passengerSafe,');
    expect(incidentRouteSource).toContain("typeof passengerSafe !== 'boolean'");
    expect(incidentRouteSource).toContain(
      "passengerSafe: typeof passengerSafe === 'boolean' ? passengerSafe : undefined",
    );
  });

  it('preserves the existing inference only when passenger safety is omitted', () => {
    expect(createIncidentSource).toContain('passengerSafe: input.passengerSafe ?? !input.injuries');
  });

  it('matches the operational trip reporting path that already records passenger safety', () => {
    expect(operationsRouteSource).toContain('passengerSafe: body.passengerSafe !== false');
  });
});
