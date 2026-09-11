import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection template input validation contract', () => {
  it('rejects malformed names and checklist item shapes before trimming untrusted values', () => {
    const service = source('src/lib/inspection-template-service.ts');

    expect(service).toContain("const name = typeof input.name === 'string' ? input.name.trim() : '';");
    expect(service).toContain("if (!raw || typeof raw !== 'object' || Array.isArray(raw))");
    expect(service).toContain("const category = typeof item.category === 'string' ? item.category.trim() : '';");
    expect(service).toContain("const label = typeof item.label === 'string' ? item.label.trim() : '';");
    expect(service).toContain("throw new InspectionTemplateError('Every checklist item requires a category and label', 422)");

    expect(service).not.toContain('item.category?.trim()');
    expect(service).not.toContain('item.label?.trim()');
    expect(service).not.toContain('input.name?.trim()');
  });
});
