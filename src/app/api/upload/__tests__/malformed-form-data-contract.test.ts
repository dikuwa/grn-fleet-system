import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/upload/route.ts'), 'utf8');

describe('upload malformed form-data guard', () => {
  it('returns a controlled client error when multipart parsing fails', () => {
    const declarationIndex = source.indexOf('let formData: FormData;');
    const parseIndex = source.indexOf('formData = await request.formData();');
    const errorIndex = source.indexOf("{ error: 'Invalid upload form data.' }, { status: 400 }");
    const fileIndex = source.indexOf("const file = formData.get('file') as File | null;");

    expect(declarationIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(declarationIndex);
    expect(errorIndex).toBeGreaterThan(parseIndex);
    expect(fileIndex).toBeGreaterThan(errorIndex);
    expect(source).not.toContain('const formData = await request.formData();');
  });
});
