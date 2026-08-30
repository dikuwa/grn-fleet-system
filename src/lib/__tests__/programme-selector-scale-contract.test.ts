import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const requestPage = readFileSync('src/app/(dashboard)/dashboard/requests/new/page.tsx', 'utf8');
const programmeRoute = readFileSync('src/app/api/programmes/route.ts', 'utf8');

describe('programme selector scale audit contract', () => {
  it('documents the current bounded selector until searchable integration replaces it', () => {
    expect(requestPage).toContain("fetch('/api/programmes?selectable=1&limit=50')");
    expect(programmeRoute).toContain('const limit = selectable ? 500 : requestedLimit');
  });
});
