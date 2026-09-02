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

describe('incident safety and injury evidence parity', () => {
  it('accepts explicit passenger safety on the dedicated incident API', () => {
    expect(incidentRouteSource).toContain('passengerSafe,');
    expect(incidentRouteSource).toContain("typeof passengerSafe !== 'boolean'");
    expect(incidentRouteSource).toContain(
      "passengerSafe: typeof passengerSafe === 'boolean' ? passengerSafe : undefined",
    );
  });

  it('preserves explicit injury counts and validates their relationship with the injury flag', () => {
    expect(incidentRouteSource).toContain('numberInjured,');
    expect(incidentRouteSource).toContain('Number injured must be a non-negative whole number');
    expect(incidentRouteSource).toContain('Number injured must be at least 1 when injuries are reported');
    expect(incidentRouteSource).toContain('Number injured must be 0 when no injuries are reported');
    expect(incidentRouteSource).toContain('numberInjured: normalizedInjuryCount');
  });

  it('preserves the existing passenger inference only when passenger safety is omitted', () => {
    expect(createIncidentSource).toContain('passengerSafe: input.passengerSafe ?? !input.injuries');
  });

  it('preserves passenger-safety omission and explicit booleans in trip operations', () => {
    expect(operationsRouteSource).toContain(
      "passengerSafe: typeof body.passengerSafe === 'boolean' ? body.passengerSafe : undefined",
    );
    expect(operationsRouteSource).toContain(
      'Passenger safety must be true, false, or omitted when unknown',
    );
    expect(operationsRouteSource).not.toContain('passengerSafe: body.passengerSafe !== false');
  });

  it('validates operation injury counts before coercion and preserves the normalized count', () => {
    expect(operationsRouteSource).toContain('injuryCountHasValidRawType');
    expect(operationsRouteSource).toContain('Number injured must be a numeric whole number');
    expect(operationsRouteSource).toContain('Number injured must be a non-negative whole number');
    expect(operationsRouteSource).toContain('Number injured must be at least 1 when injuries are reported');
    expect(operationsRouteSource).toContain('Number injured must be 0 when no injuries are reported');
    expect(operationsRouteSource).toContain('numberInjured: normalizedInjuryCount');
    expect(operationsRouteSource).not.toContain('Math.max(1, Number(body.numberInjured) || 1)');
  });
});
