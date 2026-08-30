#!/usr/bin/env node
/**
 * Page-render benchmark + perf regression guard.
 *
 * Times real RSC page renders for server-rendered routes and also times the
 * authenticated programme-detail API consumed by the client-side detail page.
 *
 * Usage:
 *   node scripts/bench-pages.mjs
 *   node scripts/bench-pages.mjs --budget
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const BUDGET_MODE = process.argv.includes('--budget');
const RUNS = 3;
const TIMEOUT_MS = 25_000;

const BEFORE = {
  '/dashboard': 2.3,
  '/dashboard/staff': 8.2,
  '/dashboard/requests': 3.1,
  '/dashboard/documents': 3.4,
  '/dashboard/fleet': 2.6,
  '/dashboard/drivers': 3.9,
  '/dashboard/admin/users': 3.8,
};

const BUDGETS = {
  '/dashboard': 6,
  '/dashboard/staff': 6,
  '/dashboard/requests': 7,
  '/dashboard/documents': 7,
  '/dashboard/fleet': 6,
  '/dashboard/drivers': 7,
  '/dashboard/admin/users': 7,
  '/dashboard/programmes': 7,
};
const PROGRAMME_DETAIL_API_BUDGET = 7;

async function main() {
  const cookieJar = await signIn();
  const results = [];

  for (const [page, budget] of Object.entries(BUDGETS)) {
    await timeRender(page, cookieJar).catch(() => {});
    const durations = [];
    for (let run = 0; run < RUNS; run++) durations.push(await timeRender(page, cookieJar));
    durations.sort((a, b) => a - b);
    results.push({ target: page, budget, best: durations[0], before: BEFORE[page] });
  }

  const programmeId = await resolveProgrammeDetailPath(cookieJar);
  if (!programmeId) {
    if (BUDGET_MODE) {
      console.error('Perf regression guard requires at least one visible seeded programme.');
      process.exit(1);
    }
  } else {
    const target = `/api/programmes/${programmeId}`;
    await timeApiRequest(target, cookieJar).catch(() => {});
    const durations = [];
    for (let run = 0; run < RUNS; run++) durations.push(await timeApiRequest(target, cookieJar));
    durations.sort((a, b) => a - b);
    results.push({ target: 'programme detail API', budget: PROGRAMME_DETAIL_API_BUDGET, best: durations[0], before: undefined });
  }

  console.log('\nRuntime benchmark (seconds)');
  console.log('─'.repeat(88));
  console.log('target'.padEnd(44) + 'before'.padStart(8) + 'after'.padStart(8) + 'Δ'.padStart(8) + 'budget'.padStart(8) + 'status'.padStart(10));
  console.log('─'.repeat(88));

  let failed = false;
  for (const { target, budget, best, before } of results) {
    const delta = before !== undefined ? best - before : NaN;
    const ok = best <= budget;
    if (!ok) failed = true;
    console.log(
      target.padEnd(44) +
        (before !== undefined ? before.toFixed(1) : '—').padStart(8) +
        best.toFixed(1).padStart(8) +
        (Number.isFinite(delta) ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '—').padStart(8) +
        `${budget}s`.padStart(8) +
        (ok ? '  ok'.padStart(10) : '  OVER'.padStart(10)),
    );
  }
  console.log('─'.repeat(88));

  if (BUDGET_MODE && failed) {
    console.error('\n✗ Perf regression guard failed: at least one target exceeded its budget.');
    process.exit(1);
  }
  if (BUDGET_MODE) console.log('\n✓ Perf regression guard passed: all targets within budget.');
}

async function signIn() {
  const res = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}) for ${EMAIL}`);
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(';')[0]).filter((c) => /^[^=]+=.+/.test(c)).join('; ');
  if (!cookie) throw new Error('Sign-in succeeded but no session cookie was returned.');
  return cookie;
}

async function resolveProgrammeDetailPath(cookie) {
  const res = await fetch(`${BASE}/api/programmes?limit=1`, {
    headers: { Cookie: cookie },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Programme benchmark discovery failed (${res.status}).`);
  const json = await res.json();
  return json?.data?.[0]?.id ?? null;
}

async function timeApiRequest(path, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API benchmark request failed for ${path} (${res.status}).`);
    await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
  return (performance.now() - started) / 1000;
}

async function timeRender(path, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Cookie: cookie,
        RSC: '1',
        'Next-Url': path,
        'Next-Router-State-Tree': routerStateTree(path),
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Page benchmark request failed for ${path} (${res.status}).`);
    await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
  return (performance.now() - started) / 1000;
}

function routerStateTree(path) {
  const segments = path.split('/').filter(Boolean);
  return encodeURIComponent(JSON.stringify(['', { children: buildChildren(segments) }]));
}

function buildChildren(segments, index = 0) {
  if (index >= segments.length) return ['__PAGE__', {}];
  return [segments[index], { children: buildChildren(segments, index + 1) }];
}

main().catch((err) => {
  console.error('bench-pages failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
