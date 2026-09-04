import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mvaService = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/mva.ts'),
  'utf8',
);

describe('incident service UUID guard contract', () => {
  it('rejects malformed incident ids before the tenant incident query', () => {
    const helperStart = mvaService.indexOf('export async function getTenantIncident');
    const helperEnd = mvaService.indexOf('/** Refresh the correct incident document family', helperStart);
    const helperSource = mvaService.slice(helperStart, helperEnd);

    expect(mvaService).toContain('const UUID_PATTERN =');
    expect(helperSource).toContain('if (!UUID_PATTERN.test(incidentId)) return null;');

    const guardIndex = helperSource.indexOf('if (!UUID_PATTERN.test(incidentId)) return null;');
    const dbIndex = helperSource.indexOf('const db = getDb()');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(dbIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(dbIndex);
  });

  it('keeps all MVA workflow service entry points behind getTenantIncident', () => {
    for (const functionName of [
      'updateInvestigation',
      'updateInsurance',
      'completeIncidentDetails',
      'recordTechnicalClearance',
      'generateMvaReport',
    ]) {
      const functionStart = mvaService.indexOf(`export async function ${functionName}`);
      expect(functionStart).toBeGreaterThan(-1);
      const nextFunction = mvaService.indexOf('export async function ', functionStart + 1);
      const functionSource = mvaService.slice(
        functionStart,
        nextFunction === -1 ? undefined : nextFunction,
      );
      expect(functionSource).toContain('getTenantIncident(tenantId, incidentId)');
    }
  });
});
