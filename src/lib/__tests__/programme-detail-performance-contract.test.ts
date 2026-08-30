import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const benchmark = readFileSync('scripts/bench-pages.mjs', 'utf8');
const detailPage = readFileSync('src/app/(dashboard)/dashboard/programmes/[id]/page.tsx', 'utf8');

describe('programme detail runtime performance guard', () => {
  it('discovers a real seeded programme before benchmarking detail', () => {
    expect(benchmark).toContain('resolveProgrammeDetailPath');
    expect(benchmark).toContain('/api/programmes?limit=1');
    expect(benchmark).toContain('PROGRAMME_DETAIL_API_BUDGET');
  });

  it('times the client data endpoint used by the programme detail page', () => {
    expect(detailPage).toContain('fetch(`/api/programmes/${id}`)');
    expect(benchmark).toContain('const target = `/api/programmes/${programmeId}`');
    expect(benchmark).toContain('timeApiRequest(target, cookieJar)');
  });
});
