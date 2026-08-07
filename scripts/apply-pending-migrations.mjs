/**
 * Recovery utility: apply pending forward-only drizzle migrations.
 *
 * This database's drizzle.__drizzle_migrations ledger uses the legacy
 * (id, hash, created_at) format, which newer drizzle-kit versions refuse to
 * write to ("INSERT has more target columns than expressions"). This script
 * applies any journaled migration whose sha256(file) hash is not yet in the
 * ledger, then records it in the same legacy format — the exact state a
 * successful `pnpm db:migrate` would have produced.
 *
 * Only forward/additive migrations run (0034-0041 all use IF NOT EXISTS /
 * WHERE NOT EXISTS guards). Nothing is dropped or truncated.
 *
 * Usage (from repo root):
 *   node scripts/apply-pending-migrations.mjs [env-file]   # default .env.local
 *   DATABASE_URL=... node scripts/apply-pending-migrations.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd(); // run from the project root
const envFile = process.argv[2] || '.env.local';

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
if (!DATABASE_URL) { console.error('No DATABASE_URL found'); process.exit(1); }

const postgres = (await import('postgres')).default;
const sql = postgres(DATABASE_URL, { max: 2 });

const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/db/migrations/meta/_journal.json'), 'utf8'));
const MIGRATIONS_DIR = path.join(ROOT, 'src/db/migrations');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex');
}

try {
  const appliedRows = await sql`SELECT hash FROM drizzle.__drizzle_migrations`;
  const applied = new Set(appliedRows.map((r) => r.hash));
  const [maxRow] = await sql`SELECT COALESCE(MAX(id), 0) AS m FROM drizzle.__drizzle_migrations`;
  let nextId = maxRow.m + 1;

  const toRun = [];
  for (const entry of journal.entries) {
    const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(file)) { console.log(`skip (missing file): ${entry.tag}`); continue; }
    const hash = sha256(file);
    if (!applied.has(hash)) toRun.push({ tag: entry.tag, file, hash, when: entry.when });
  }

  console.log(`Pending migrations to apply: ${toRun.map((m) => m.tag).join(', ') || '(none)'}`);
  if (toRun.length === 0) { await sql.end(); process.exit(0); }

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
