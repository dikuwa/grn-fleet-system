/**
 * Recovery utility: apply pending forward-only SQL migrations.
 *
 * This database's drizzle.__drizzle_migrations ledger uses the legacy
 * (id, hash, created_at) format, which newer drizzle-kit versions refuse to
 * write to ("INSERT has more target columns than expressions"). This script
 * applies every numbered SQL migration whose sha256(file) hash is not yet in
 * the ledger, then records it in the same legacy format — the exact state a
 * successful migration run would have produced.
 *
 * The Drizzle journal remains the preferred ordering source, but older repo
 * work has occasionally added a numbered forward migration without adding a
 * journal entry. Numbered SQL files missing from the journal are therefore
 * appended in filename order instead of being silently skipped. This keeps
 * production prebuild and local recovery behavior aligned with the actual
 * migration directory.
 *
 * Nothing is dropped or truncated by this runner; migrations themselves are
 * responsible for being forward-safe/idempotent.
 *
 * Usage (from repo root):
 *   node scripts/apply-pending-migrations.mjs [env-file]   # default .env.local
 *   DATABASE_URL=... node scripts/apply-pending-migrations.mjs
 *
 * Used as the Vercel "prebuild" hook (see package.json). In that context the
 * production DATABASE_URL is injected by Vercel, so pass --allow-missing-db
 * to skip gracefully when no database is configured (e.g. preview builds).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd(); // run from the project root
const allowMissingDb = process.argv.includes('--allow-missing-db');
const envFile = process.argv.slice(2).find((argument) => !argument.startsWith('-')) || '.env.local';

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (!val.startsWith('"') && !val.startsWith("'")) val = val.replace(/#.*$/, '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[m[1]] = val;
  }
  return out;
}

const env = { ...loadEnv(path.join(ROOT, '.env')), ...loadEnv(path.join(ROOT, envFile)) };
const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
if (!DATABASE_URL) {
  if (allowMissingDb) {
    console.log('No DATABASE_URL available; skipping migrations (--allow-missing-db).');
    process.exit(0);
  }
  console.error('No DATABASE_URL found');
  process.exit(1);
}

const postgres = (await import('postgres')).default;
const sql = postgres(DATABASE_URL, { max: 2 });

const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/db/migrations/meta/_journal.json'), 'utf8'));
const MIGRATIONS_DIR = path.join(ROOT, 'src/db/migrations');
const NUMBERED_MIGRATION = /^\d{4}_.+\.sql$/;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex');
}

function migrationEntries() {
  const journalEntries = journal.entries.map((entry) => ({
    tag: entry.tag,
    when: entry.when,
  }));
  const journalTags = new Set(journalEntries.map((entry) => entry.tag));
  const unjournaled = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => NUMBERED_MIGRATION.test(name))
    .map((name) => name.replace(/\.sql$/, ''))
    .filter((tag) => !journalTags.has(tag))
    .sort()
    .map((tag, index) => ({
      tag,
      // created_at is ledger metadata only. Give unjournaled forward files a
      // stable monotonic value after the latest journaled migration.
      when: Math.max(0, ...journalEntries.map((entry) => Number(entry.when) || 0)) + index + 1,
    }));

  if (unjournaled.length > 0) {
    console.warn(
      `Migration journal is missing: ${unjournaled.map((entry) => entry.tag).join(', ')}. ` +
        'Applying those numbered forward migrations in filename order.',
    );
  }

  return [...journalEntries, ...unjournaled];
}

try {
  const appliedRows = await sql`SELECT hash FROM drizzle.__drizzle_migrations`;
  const applied = new Set(appliedRows.map((r) => r.hash));
  const [maxRow] = await sql`SELECT COALESCE(MAX(id), 0) AS m FROM drizzle.__drizzle_migrations`;
  let nextId = maxRow.m + 1;

  const toRun = [];
  for (const entry of migrationEntries()) {
    const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) {
      console.log(`skip (missing file): ${entry.tag}`);
      continue;
    }
    const hash = sha256(file);
    if (!applied.has(hash)) toRun.push({ tag: entry.tag, file, hash, when: entry.when });
  }

  console.log(`Pending migrations to apply: ${toRun.map((m) => m.tag).join(', ') || '(none)'}`);
  if (toRun.length === 0) {
    await sql.end();
    process.exit(0);
  }

  for (const m of toRun) {
    const statement = fs.readFileSync(m.file, 'utf8');
    process.stdout.write(`applying ${m.tag} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(statement);
      await tx`INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (${nextId}, ${m.hash}, ${m.when})`;
    });
    nextId += 1;
    console.log('OK');
  }

  console.log('\nDone. Applied', toRun.length, 'migration(s).');
} finally {
  await sql.end();
}
