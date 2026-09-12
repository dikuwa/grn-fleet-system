import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('upload SHA-256 multipart field validation', () => {
  it('rejects non-text SHA-256 form values before string normalization', () => {
    const route = source('src/app/api/upload/route.ts');

    expect(route).toContain("const rawClientSha256 = formData.get('sha256');");
    expect(route).toContain("rawClientSha256 !== null && typeof rawClientSha256 !== 'string'");
    expect(route).toContain("SHA-256 must be provided as text.");
    expect(route).toContain("const clientSha256 = rawClientSha256?.trim().toLowerCase() || null;");
    expect(route).not.toContain("(formData.get('sha256') as string | null)");
  });
});
