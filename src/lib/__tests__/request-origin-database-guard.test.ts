import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('submitted request-origin database guard', () => {
  it('preserves the stored origin once a request has entered governed workflow', () => {
    const migration = read('src/db/migrations/0097_request_origin_immutability.sql');

    expect(migration).toContain('BEFORE UPDATE OF request_origin ON transport_requests');
    expect(migration).toContain("OLD.submitted_at IS NOT NULL OR OLD.status <> 'draft'");
    expect(migration).toContain('NEW.request_origin := OLD.request_origin');
  });

  it('keeps correction revision metadata truthful when a stale caller proposes an origin change', () => {
    const migration = read('src/db/migrations/0097_request_origin_immutability.sql');

    expect(migration).toContain('trg_normalize_request_revision_origin_flag');
    expect(migration).toContain("'{requestOrigin}'");
    expect(migration).toContain("'false'::jsonb");
  });

  it('does not silently skip numbered forward migrations that are missing from the journal', () => {
    const runner = read('scripts/apply-pending-migrations.mjs');

    expect(runner).toContain('NUMBERED_MIGRATION');
    expect(runner).toContain('unjournaled');
    expect(runner).toContain('Applying those numbered forward migrations in filename order.');
  });
});
