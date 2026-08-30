import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const combobox = readFileSync('src/components/ui/employee-combobox.tsx', 'utf8');
const peopleSearch = readFileSync('src/app/api/people-search/route.ts', 'utf8');
const requestPage = readFileSync('src/app/(dashboard)/dashboard/requests/new/page.tsx', 'utf8');

describe('large tenant staff selector contract', () => {
  it('uses server-side searchable employee selection instead of preloading a bounded roster', () => {
    expect(combobox).toContain("new URLSearchParams({ kind, limit: '20' })");
    expect(combobox).toContain("params.set('q', debouncedSearch)");
    expect(combobox).toContain('fetch(`/api/people-search?${params}`');
    expect(combobox).not.toContain('/api/employees?limit=');
  });

  it('keeps people search tenant scoped, active-staff scoped and paginated', () => {
    expect(peopleSearch).toContain('eq(employees.tenantId, session.tenantId)');
    expect(peopleSearch).toContain("eq(employees.employmentStatus, 'active')");
    expect(peopleSearch).toContain("request.nextUrl.searchParams.get('page')");
    expect(peopleSearch).toContain('.limit(limit)');
    expect(peopleSearch).toContain('.offset(offset)');
    expect(peopleSearch).toContain('totalPages: Math.ceil(Number(total) / limit)');
  });

  it('keeps request requester/passenger/driver inputs on the searchable selector path', () => {
    expect(requestPage).toContain("import { EmployeeCombobox, type EmployeeSearchOption }");
    expect(requestPage).toContain("import { EmployeeMultiSelect }");
    expect(requestPage).toContain('<EmployeeCombobox');
    expect(requestPage).toContain('<EmployeeMultiSelect');
  });
});
