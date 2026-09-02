import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/investigation/route.ts'),
  'utf8',
);

describe('incident investigation input validation contract', () => {
  it('validates status before selecting the mutation permission', () => {
    const validationIndex = routeSource.indexOf("typeof body.status !== 'string'");
    const permissionIndex = routeSource.indexOf('const permCheck = await requirePermission(');
    expect(validationIndex).toBeGreaterThan(-1);
    expect(permissionIndex).toBeGreaterThan(validationIndex);
    expect(routeSource).toContain('INVESTIGATION_STATUSES.includes(body.status)');
  });

  it('rejects malformed notes and accident report numbers at the HTTP boundary', () => {
    expect(routeSource).toContain("typeof body.notes !== 'string'");
    expect(routeSource).toContain("typeof body.accidentReportNumber !== 'string'");
    expect(routeSource).toContain('Investigation notes must be text or null');
    expect(routeSource).toContain('Accident report number must be text or null');
  });

  it('requires added witnesses to be objects with render-safe text fields', () => {
    expect(routeSource).toContain('!Array.isArray(body.addedWitnesses)');
    expect(routeSource).toContain('body.addedWitnesses.some((witness: unknown) => {');
    expect(routeSource).toContain("const witnessTextFields = ['name', 'phone', 'statement'] as const;");
    expect(routeSource).toContain("typeof witnessRecord[field] !== 'string'");
    expect(routeSource).toContain('name, phone and statement fields must contain text or null values');
  });

  it('normalizes text without turning explicit null notes into omitted data', () => {
    expect(routeSource).toContain('body.notes.trim() || null');
    expect(routeSource).toContain(': body.notes,');
    expect(routeSource).toContain('body.accidentReportNumber.trim() || undefined');
  });
});
