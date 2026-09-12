import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);

function actionSection(action: string, nextAction: string) {
  const start = routeSource.indexOf(`if (action === '${action}')`);
  const end = routeSource.indexOf(`if (action === '${nextAction}')`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return routeSource.slice(start, end);
}

describe('incident review document refresh contract', () => {
  it('refreshes canonical incident documents after unified insurance updates', () => {
    const section = actionSection('insurance_update', 'technical_clearance');
    const commitIndex = section.indexOf('await db.execute(sql`');
    const refreshIndex = section.indexOf('await refreshIncidentOperationalDocuments({');
    const responseIndex = section.indexOf('return NextResponse.json({ success: true });');

    expect(commitIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(commitIndex);
    expect(responseIndex).toBeGreaterThan(refreshIndex);
  });

  it('refreshes canonical incident documents after unified technical clearance', () => {
    const section = actionSection('technical_clearance', 'close_investigation');
    const commitIndex = section.indexOf('await db.execute(sql`');
    const refreshIndex = section.indexOf('await refreshIncidentOperationalDocuments({');
    const responseIndex = section.indexOf(
      'return NextResponse.json({ success: true, alreadyCleared: false });',
    );

    expect(commitIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(commitIndex);
    expect(responseIndex).toBeGreaterThan(refreshIndex);
  });
});
