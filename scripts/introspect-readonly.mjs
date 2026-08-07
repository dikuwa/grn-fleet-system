/** READ-ONLY schema introspection for the GovFleet recovery audit. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const envFile = process.argv[2] || '.env.local';
const env = { ...loadEnv(path.resolve(__dirname, '..', '.env')), ...loadEnv(path.resolve(__dirname, '..', envFile)) };
const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL) { console.error('No DATABASE_URL'); process.exit(1); }
const u = new URL(DATABASE_URL);
console.log(`== Target database: ${u.hostname} / ${(u.pathname || '').split('/')[1]} ==`);

const postgres = (await import('postgres')).default;
const sql = postgres(DATABASE_URL, { max: 2 });

try {
  // 1. tenants columns
  const cols = await sql`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'tenants' ORDER BY ordinal_position`;
  console.log('\nTENANTS COLUMNS:');
  console.log(cols.map((c) => `  ${c.column_name} ${c.data_type}${c.column_default ? ` default=${c.column_default}` : ''}`).join('\n'));

  // 2. tables that should exist post-SaaS
  const want = ['cms_content', 'cms_site_settings', 'cms_faqs', 'tenant_subscriptions', 'subscription_packages', 'subscription_addons', 'billing_settings', 'payment_submissions', 'invitations', 'demo_requests', 'reset_requests'];
  const have = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  const haveSet = new Set(have.map((r) => r.table_name));
  console.log('\nSAAS/CMS TABLE CHECK (public schema):');
  for (const t of want) console.log(`  ${t}: ${haveSet.has(t) ? 'EXISTS' : 'MISSING'}`);
  console.log('\nAll public tables (' + haveSet.size + '):');
  console.log('  ' + [...haveSet].sort().join(', '));

  // 3. drizzle migrations applied
  for (const schema of ['drizzle', 'public']) {
    try {
      const rows = await sql.unsafe(`SELECT * FROM ${schema}."__drizzle_migrations" ORDER BY created_at`, []);
      if (rows.length) {
        console.log(`\nAPPLIED MIGRATIONS (${schema}.__drizzle_migrations, ${rows.length}):`);
        console.log(rows.map((r) => `  ${r.id} ${String(r.hash).slice(0, 12)} ${r.created_at?.toISOString?.() ?? r.created_at}`).join('\n'));
        break;
      }
    } catch { /* try next schema */ }
  }
} finally {
  await sql.end();
}
