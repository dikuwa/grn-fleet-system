import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/fleet/route.ts'), 'utf8');

describe('fleet list/create malformed-id guards', () => {
  it('rejects malformed category filters before UUID-backed fleet conditions', () => {
    const paramsIndex = source.indexOf("const categoryId = searchParams.get('category_id')?.trim();");
    const guardIndex = source.indexOf('if (categoryId && !UUID_PATTERN.test(categoryId))');
    const conditionIndex = source.indexOf('if (categoryId) conditions.push(eq(vehicles.categoryId, categoryId));');

    expect(source).toContain('const UUID_PATTERN =');
    expect(guardIndex).toBeGreaterThan(paramsIndex);
    expect(conditionIndex).toBeGreaterThan(guardIndex);
    expect(source.slice(guardIndex, conditionIndex)).toContain("{ error: 'Category filter is invalid' }");
    expect(source.slice(guardIndex, conditionIndex)).toContain('{ status: 400 }');
  });

  it('rejects malformed create category ids before the tenant-scoped category query', () => {
    const guardIndex = source.indexOf(
      'if (body.categoryId && !UUID_PATTERN.test(String(body.categoryId)))',
    );
    const queryIndex = source.indexOf('const [category] = await db', guardIndex);

    expect(guardIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(guardIndex);
    expect(source.slice(guardIndex, queryIndex)).toContain(
      "{ error: 'Vehicle category not found in your tenant' }",
    );
    expect(source.slice(queryIndex)).toContain('eq(vehicleCategories.tenantId, session.tenantId)');
  });

  it('rejects malformed create office ids before tenant-scoped office queries', () => {
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(String(value)))');
    const queryIndex = source.indexOf('const [office] = await db', guardIndex);

    expect(guardIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(guardIndex);
    expect(source.slice(guardIndex, queryIndex)).toContain(
      "{ error: 'Selected office not found in your tenant' }",
    );
    expect(source.slice(queryIndex)).toContain('eq(offices.tenantId, session.tenantId)');
  });
});
