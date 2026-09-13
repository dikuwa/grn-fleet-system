import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'src/db/migrations/0119_notification_dedupe_legacy_quarantine.sql',
  ),
  'utf8',
);
const notificationRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

describe('notification legacy dedupe quarantine', () => {
  it('blocks notification writes while historical keys are rewritten', () => {
    const lockIndex = migration.indexOf(
      'LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE',
    );
    const firstUpdateIndex = migration.indexOf('UPDATE notifications AS n');

    expect(lockIndex).toBeGreaterThan(-1);
    expect(firstUpdateIndex).toBeGreaterThan(lockIndex);
  });

  it('uses a two-phase rewrite with row-unique quarantine targets', () => {
    const nullRewrite = migration.indexOf('SET dedupe_key = NULL');
    const quarantineRewrite = migration.indexOf(
      "SET dedupe_key = 'legacy-quarantine:v1:' || n.id::text",
    );

    expect(migration).toContain('notification_dedupe_quarantine_ids');
    expect(migration).toContain('id uuid PRIMARY KEY');
    expect(nullRewrite).toBeGreaterThan(-1);
    expect(quarantineRewrite).toBeGreaterThan(nullRewrite);
    expect(migration).toContain(
      "dedupe_key <> 'legacy-quarantine:v1:' || id::text",
    );
  });

  it('keeps the public write boundary inert before cleanup can deploy', () => {
    const postIndex = notificationRoute.indexOf('export async function POST');
    const deleteIndex = notificationRoute.indexOf('export async function DELETE');
    const postRoute = notificationRoute.slice(postIndex, deleteIndex);

    expect(postIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(postIndex);
    expect(postRoute).toContain('dedupeKey: null');
    expect(postRoute).not.toContain('dedupeKey: body.dedupeKey');
  });
});
