/**
 * READ-ONLY database audit for the GovFleet tenant/auth recovery task.
 *
 * Prints tenant lifecycle/subscription state, user/membership inventory
 * (no password hashes, no secrets) and representative data counts.
 * It performs ONLY SELECT queries — safe to run against any environment.
 *
 * Usage: node scripts/audit-readonly.mjs [env-file]   (default .env.local)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.argv[2] || '.env.local';
const envPath = path.resolve(__dirname, '..', envFile);

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    // strip trailing inline comments, keep # inside quotes untouched (crude)
    if (!val.startsWith('"') && !val.startsWith("'")) val = val.replace(/#.*$/, '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...loadEnv(path.resolve(__dirname, '..', '.env')), ...loadEnv(envPath) };
const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('No DATABASE_URL found in', envFile);
  process.exit(1);
}

let u;
try {
  u = new URL(DATABASE_URL);
} catch {
  console.error('Could not parse DATABASE_URL');
  process.exit(1);
}
console.log(`== Target database: ${u.hostname} / ${(u.pathname || '').split('/')[1]} (${u.protocol.replace(':', '')}) ==\n`);

const postgres = (await import('postgres')).default;
const sql = postgres(DATABASE_URL, { max: 2, prepare: false });

async function tableExists(name) {
  const rows = await sql`SELECT to_regclass(${name}) AS t`;
  return rows[0]?.t != null;
}

async function count(table, where = '', params = []) {
  try {
    const rows = await sql.unsafe(`SELECT count(*)::int AS n FROM ${table} ${where}`, params);
    return rows[0].n;
  } catch (e) {
    return `ERR:${String(e).slice(0, 60)}`;
  }
}

try {
  // ------------------------------------------------------------------
  // 1. TENANTS
  // ------------------------------------------------------------------
  const hasTenants = await tableExists('tenants');
  if (!hasTenants) {
    console.log('!! tenants table does not exist in this database');
    await sql.end();
    process.exit(0);
  }

  // Discover actual tenants columns so the audit works against pre-SaaS schemas too
  const tenantCols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants'`).map((r) => r.column_name);
  const pick = (...names) => names.filter((n) => tenantCols.includes(n));
  const hasLifecycle = tenantCols.includes('lifecycle_status');
  console.log(`NOTE: tenants.lifecycle_status column ${hasLifecycle ? 'EXISTS' : 'MISSING'} in this database\n`);

  const tenants = await sql`
    SELECT ${sql(pick('id', 'name', 'code', 'slug', 'type', 'status', 'plan_code', 'subscription_status', 'lifecycle_status', 'trial_ends_at', 'created_at', 'updated_at'))}
    FROM tenants ORDER BY created_at ASC`;

  console.log(`TENANTS (${tenants.length}):`);
  for (const t of tenants) {
    console.log(`  - id=${t.id} | name="${t.name}" | code=${t.code} | slug=${t.slug}`);
    console.log(`      status=${t.status} | lifecycle_status=${t.lifecycle_status ?? 'n/a'} | subscription_status=${t.subscription_status} | plan=${t.plan_code} | created=${t.created_at?.toISOString?.() ?? t.created_at} | updated=${t.updated_at?.toISOString?.() ?? t.updated_at}`);
  }

  // ------------------------------------------------------------------
  // 2. PER-TENANT DATA COUNTS (representative)
  // ------------------------------------------------------------------
  const tables = [
    'tenant_memberships',
    'user_profiles',
    'employees',
    'vehicles',
    'driver_profiles',
    'transport_requests',
    'documents',
    'roles',
    'programmes',
    'trips',
    'audit_events',
    'tenant_subscriptions',
    'cms_content',
    'cms_site_settings',
  ];

  console.log('\nPER-TENANT DATA COUNTS:');
  for (const t of tenants) {
    const line = [`memberships=${await count('tenant_memberships', 'WHERE tenant_id = $1', [t.id])}`,
      `employees=${await count('employees', 'WHERE tenant_id = $1', [t.id])}`,
      `vehicles=${await count('vehicles', 'WHERE tenant_id = $1', [t.id])}`,
      `drivers=${await count('driver_profiles', 'WHERE tenant_id = $1', [t.id])}`,
      `requests=${await count('transport_requests', 'WHERE tenant_id = $1', [t.id])}`,
      `documents=${await count('documents', 'WHERE tenant_id = $1', [t.id])}`,
      `roles=${await count('roles', 'WHERE tenant_id = $1', [t.id])}`,
      `programmes=${await count('programmes', 'WHERE tenant_id = $1', [t.id])}`,
      `trips=${await count('trips', 'WHERE tenant_id = $1', [t.id])}`,
    ];
    console.log(`  ${t.code} (${t.slug}): ${line.join(' | ')}`);
  }

  // ------------------------------------------------------------------
  // 3. SUBSCRIPTIONS
  // ------------------------------------------------------------------
  if (await tableExists('tenant_subscriptions')) {
    const subs = await sql`SELECT id, tenant_id, package_id, status, billing_interval, current_period_start, current_period_end, created_at FROM tenant_subscriptions ORDER BY created_at`;
    console.log(`\nTENANT_SUBSCRIPTIONS (${subs.length}):`);
    for (const s of subs) console.log(`  tenant=${s.tenant_id} | pkg=${s.package_id} | status=${s.status} | period=${s.current_period_start?.toISOString?.() ?? s.current_period_start} -> ${s.current_period_end?.toISOString?.() ?? s.current_period_end} | created=${s.created_at?.toISOString?.() ?? s.created_at}`);
  }

  // ------------------------------------------------------------------
  // 4. USERS + MEMBERSHIPS + ROLES (no password material)
  // ------------------------------------------------------------------
  const users = await sql`
    SELECT u.id, u.email, u.username, u.name, u.email_verified, u.created_at AS user_created,
           tm.tenant_id, tm.status AS membership_status, tm.active_workspace, tm.joined_at,
           up.display_name, up.status AS profile_status, up.account_enabled,
           up.requires_password_change, up.password_status, up.last_login_at
    FROM "user" u
    LEFT JOIN tenant_memberships tm ON tm.user_id = u.id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    ORDER BY u.created_at ASC`;

  console.log(`\nUSERS (${users.length}) — includes all users even without membership:`);
  const hasPassword = await sql`SELECT u.id, (a.password IS NOT NULL AND a.password != '') AS has_hash FROM "user" u LEFT JOIN account a ON a.user_id = u.id AND a.provider_id = 'email'`;
  const pwMap = Object.fromEntries(hasPassword.map((r) => [r.id, r.has_hash]));

  for (const row of users) {
    const roles = row.tenant_id
      ? await sql`SELECT r.name FROM role_assignments ra JOIN roles r ON r.id = ra.role_id WHERE ra.tenant_membership_id IN (SELECT id FROM tenant_memberships WHERE user_id = ${row.id} AND tenant_id = ${row.tenant_id}) AND ra.end_date IS NULL`
      : [];
    console.log(`  - username=${row.username} | email=${row.email} | name=${row.name ?? row.display_name} | id=${row.id}`);
    console.log(`      email_verified=${row.email_verified} | profile_status=${row.profile_status} | account_enabled=${row.account_enabled} | pw_change_required=${row.requires_password_change} | password_hash_present=${pwMap[row.id] === true} | last_login=${row.last_login_at?.toISOString?.() ?? row.last_login_at}`);
    if (row.tenant_id) {
      console.log(`      tenant_id=${row.tenant_id} | membership_status=${row.membership_status} | active_workspace=${row.active_workspace} | joined=${row.joined_at?.toISOString?.() ?? row.joined_at}`);
      console.log(`      active_roles=[${roles.map((r) => r.name).join(', ')}]`);
    } else {
      console.log(`      NO tenant membership`);
    }
  }

  // ------------------------------------------------------------------
  // 5. CMS STATE (public content)
  // ------------------------------------------------------------------
  if (await tableExists('cms_content')) {
    const cms = await sql`SELECT slug, title, page_type, status, is_latest, version, updated_at FROM cms_content ORDER BY page_type, slug`;
    console.log(`\nCMS_CONTENT (${cms.length}):`);
    for (const c of cms) console.log(`  ${c.slug.padEnd(16)} type=${c.page_type.padEnd(10)} status=${c.status.padEnd(9)} latest=${c.is_latest} v${c.version} updated=${c.updated_at?.toISOString?.() ?? c.updated_at}`);
  }
  if (await tableExists('cms_site_settings')) {
    const s = await sql`SELECT id, site_name, site_tagline, contact_email, is_under_maintenance, updated_at FROM cms_site_settings ORDER BY updated_at DESC`;
    console.log(`\nCMS_SITE_SETTINGS (${s.length}):`);
    for (const r of s) console.log(`  site_name=${r.site_name} | tagline=${r.site_tagline} | email=${r.contact_email} | maintenance=${r.is_under_maintenance} | updated=${r.updated_at?.toISOString?.() ?? r.updated_at}`);
  }

  // ------------------------------------------------------------------
  // 6. DUPLICATE CHECK
  // ------------------------------------------------------------------
  const dupUsernames = await sql`SELECT username, count(*)::int AS n FROM "user" WHERE username IS NOT NULL GROUP BY username HAVING count(*) > 1`;
  const dupEmails = await sql`SELECT email, count(*)::int AS n FROM "user" GROUP BY email HAVING count(*) > 1`;
  if (dupUsernames.length || dupEmails.length) {
    console.log('\nDUPLICATES FOUND:');
    if (dupUsernames.length) console.log('  usernames:', dupUsernames.map((r) => `${r.username}(${r.n})`).join(', '));
    if (dupEmails.length) console.log('  emails:', dupEmails.map((r) => `${r.email}(${r.n})`).join(', '));
  } else {
    console.log('\nNo duplicate usernames or emails.');
  }
} finally {
  await sql.end();
}
