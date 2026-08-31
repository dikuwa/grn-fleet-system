import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const requestPage = readFileSync(
  'src/app/(dashboard)/dashboard/requests/new/page.tsx',
  'utf8',
);
const selector = readFileSync('src/components/ui/programme-combobox.tsx', 'utf8');
const programmeRoute = readFileSync('src/app/api/programmes/route.ts', 'utf8');

describe('searchable programme selector contract', () => {
  it('uses server-backed programme search in the request wizard', () => {
    expect(requestPage).toContain("@/components/ui/programme-combobox");
    expect(requestPage).toContain('<ProgrammeCombobox');
    expect(requestPage).not.toContain("fetch('/api/programmes?selectable=1&limit=50')");
    expect(requestPage).toContain("get('programmeId')");
    expect(requestPage).toContain('programmeId: formData.programmeId || undefined');
  });

  it('searches selectable programmes in a small debounced window', () => {
    expect(selector).toContain("selectable: '1'");
    expect(selector).toContain("limit: '20'");
    expect(selector).toContain("params.set('q', debouncedSearch)");
    expect(selector).toContain("queryKey: ['programme-search', debouncedSearch]");
  });

  it('hydrates a selected programme that is outside the latest search window', () => {
    expect(selector).toContain("queryKey: ['programme-selected', value]");
    expect(selector).toContain('/api/programmes/${encodeURIComponent(value)}');
    expect(selector).toContain('resolvedSelectedOption');
  });

  it('preserves canonical selectable eligibility while respecting requested pagination', () => {
    expect(programmeRoute).toContain(
      "Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 25))",
    );
    expect(programmeRoute).toContain("programmes.status} IN ('approved', 'published')");
    expect(programmeRoute).toContain('programmeEndDateCurrentSql(programmes.endDate)');
    expect(programmeRoute).not.toContain('selectable ? 500');
  });
});
