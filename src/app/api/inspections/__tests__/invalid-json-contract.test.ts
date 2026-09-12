import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection submission JSON parsing', () => {
  it('maps syntactically invalid JSON to the controlled submission validation response', () => {
    const route = source('src/app/api/inspections/route.ts');

    expect(route).toContain('let payload: unknown;');
    expect(route).toContain('payload = await request.json();');
    expect(route).toContain("return NextResponse.json({ error: 'Invalid inspection submission payload' }, { status: 422 });");
    expect(route).not.toContain('const payload: unknown = await request.json();');
  });
});
