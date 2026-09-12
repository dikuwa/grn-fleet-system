import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const collectionRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspection-templates/route.ts'),
  'utf8',
);
const itemRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspection-templates/[id]/route.ts'),
  'utf8',
);

describe('inspection template JSON payload guards', () => {
  it('guards create payload parsing after authorization and before template creation', () => {
    const authIndex = collectionRoute.indexOf("requireTemplateManager(request, 'create')");
    const parseIndex = collectionRoute.indexOf('payload = await request.json()');
    const shapeGuardIndex = collectionRoute.indexOf(
      "if (!payload || typeof payload !== 'object' || Array.isArray(payload))",
    );
    const createIndex = collectionRoute.indexOf('const template = await createInspectionTemplateVersion({');

    expect(authIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(authIndex);
    expect(shapeGuardIndex).toBeGreaterThan(parseIndex);
    expect(createIndex).toBeGreaterThan(shapeGuardIndex);
    expect(collectionRoute).toContain("{ error: 'Invalid inspection template payload' }");
    expect(collectionRoute).toContain('{ status: 422 }');
  });

  it('guards version payload parsing after tenant-scoped template lookup', () => {
    const lookupIndex = itemRoute.indexOf(
      'const existing = await loadInspectionTemplate(auth.session.tenantId, id);',
    );
    const parseIndex = itemRoute.indexOf('payload = await request.json()');
    const shapeGuardIndex = itemRoute.indexOf(
      "if (!payload || typeof payload !== 'object' || Array.isArray(payload))",
    );
    const createIndex = itemRoute.indexOf('const template = await createInspectionTemplateVersion({');

    expect(lookupIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(lookupIndex);
    expect(shapeGuardIndex).toBeGreaterThan(parseIndex);
    expect(createIndex).toBeGreaterThan(shapeGuardIndex);
    expect(itemRoute).toContain("{ error: 'Invalid inspection template payload' }");
    expect(itemRoute).toContain('{ status: 422 }');
  });
});
