import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canonicalHeaders = [
  'employee_number', 'title', 'first_name', 'middle_names', 'last_name', 'gender',
  'job_title', 'job_grade', 'department', 'office', 'email', 'phone',
  'employment_status', 'is_driver',
];

describe('staff import template', () => {
  it('contains only the canonical header row and no tenant staff data', async () => {
    const file = await readFile(resolve(process.cwd(), 'public/staff-import-template.csv'), 'utf8');
    const rows = file.trim().split(/\r?\n/);
    expect(rows).toHaveLength(1);
    expect(rows[0].split(',')).toEqual(canonicalHeaders);
  });
});
