import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);

describe('inspection submission payload validation', () => {
  it('rejects malformed nested values before checklist processing or service execution', () => {
    const permissionIndex = source.indexOf(
      'requirePermission(session, Permissions.INSPECTION_PERFORM)',
    );
    const payloadIndex = source.indexOf('payload = await request.json()');
    const malformedGuardIndex = source.indexOf(
      'if (!isRecord(payload) || hasMalformedSubmissionFields(payload))',
    );
    const checklistIndex = source.indexOf('const checklist = Array.isArray(body.checklist)');
    const serviceIndex = source.indexOf('const result = await completeOfficialInspection({');

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(payloadIndex).toBeGreaterThan(permissionIndex);
    expect(malformedGuardIndex).toBeGreaterThan(payloadIndex);
    expect(checklistIndex).toBeGreaterThan(malformedGuardIndex);
    expect(serviceIndex).toBeGreaterThan(checklistIndex);
    expect(source).toContain("{ error: 'Invalid inspection submission payload' }");
    expect(source).toContain('{ status: 422 }');
  });

  it('guards checklist object fields that the service dereferences or trims', () => {
    const helperStart = source.indexOf('function hasMalformedSubmissionFields');
    const postStart = source.indexOf('export async function POST');
    const helper = source.slice(helperStart, postStart);

    expect(helper).toContain('!isRecord(item)');
    expect(helper).toContain("typeof item.label !== 'string'");
    expect(helper).toContain("typeof item.result !== 'string'");
    expect(helper).toContain("typeof item.comment !== 'string'");
  });

  it('rejects malformed evidence, notes, fuel level and offline sync tokens instead of discarding them', () => {
    const helperStart = source.indexOf('function hasMalformedSubmissionFields');
    const postStart = source.indexOf('export async function POST');
    const helper = source.slice(helperStart, postStart);

    expect(helper).toContain("body.photoKeys.some((key) => typeof key !== 'string')");
    expect(helper).toContain("typeof body.notes !== 'string'");
    expect(helper).toContain("typeof body.fuelLevel !== 'string'");
    expect(helper).toContain("typeof body.clientSyncId !== 'string'");
  });
});
