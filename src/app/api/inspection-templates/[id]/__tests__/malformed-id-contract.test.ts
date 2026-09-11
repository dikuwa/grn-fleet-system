import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection template malformed id guard', () => {
  it('validates the UUID path parameter after authorization and before every database-backed template action', () => {
    const route = source('src/app/api/inspection-templates/[id]/route.ts');

    expect(route).toContain('const UUID_PATTERN =');
    expect(route).toContain("NextResponse.json({ error: 'Template not found' }, { status: 404 })");
    expect(route.match(/const malformedId = malformedTemplateIdResponse\(id\);/g)).toHaveLength(3);
    expect(route.match(/if \(malformedId\) return malformedId;/g)).toHaveLength(3);

    const firstAuth = route.indexOf("requireTemplateManager(request, 'view')");
    const firstGuard = route.indexOf('malformedTemplateIdResponse(id)');
    const firstLookup = route.indexOf('loadInspectionTemplate(auth.session.tenantId, id)');

    expect(firstAuth).toBeGreaterThan(-1);
    expect(firstGuard).toBeGreaterThan(firstAuth);
    expect(firstLookup).toBeGreaterThan(firstGuard);
  });
});
