#!/usr/bin/env node
/**
 * Page-render benchmark + perf regression guard.
 *
 * Times real page renders (the same RSC navigation the browser performs) for
 * the pages most likely to regress into multi-second cold-start renders, and
 * compares them against the recorded pre-fix baseline (the staff page used to
 * take 6–9s because every hasPermission() call ran its own 4-query Neon
 * chain).
 *
 * Usage:
 *   node scripts/bench-pages.mjs                 # benchmark, informational
 *   node scripts/bench-pages.mjs --budget        # exit 1 if any page over budget
 *   NEXT_PUBLIC_APP_URL=http://localhost:3000 \
 *     SEED_ADMIN_EMAIL=admin@kavangoeast.gov.na \
 *     SEED_ADMIN_PASSWORD=changeme \
 *     node scripts/bench-pages.mjs --budget
 *
 * The server must be running with a seeded database.
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const BUDGET_MODE = process.argv.includes('--budget');
const RUNS = 3; // per page, best-of reduces cold-start variance
const TIMEOUT_MS = 25_000;

/**
 * Pre-fix baseline captured 2026-08-06 against the same Neon database before
 * the React.cache role-context fix. Measured as RSC request duration (seconds)
 * with curl. Used for the before/after comparison column.
 */
const BEFORE = {
  '/dashboard': 2.3,
  '/dashboard/staff': 8.2,
  '/dashboard/requests': 3.1,
  '/dashboard/documents': 3.4,
  '/dashboard/fleet': 2.6,
  '/dashboard/drivers': 3.9,
  '/dashboard/admin/users': 3.8,
};

/**
 * CI budgets (seconds). Deliberately generous: they must catch a 6–9s
 * regression without flaking on Neon cold starts (~3–4s is the healthy warm
 * range we measured after the fix).
 */
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
const PROGRAMME_DETAIL_BUDGET = 7;

async function main() {
  const cookieJar = await signIn();
  const pages = Object.keys(BUDGETS).map((page) => ({ page, budget: BUDGETS[page] }));
  const programmeDetailPath = await resolveProgrammeDetailPath(cookieJar);
  if (programmeDetailPath) {
    pages.push({ page: programmeDetailPath, budget: PROGRAMME_DETAIL_BUDGET });
  } else if (BUDGET_MODE) {
    console.error('Perf regression guard requires at least one visible seeded programme for the programme-detail benchmark.');
    process.exit(1);
  } else {
    console.warn('No visible programme found; skipping programme-detail benchmark.');
  }

  const results = [];

  for (const { page, budget } of pages) {
    // Warm the page first (untimed): in CI the bench runs against `next dev`,
    // which compiles pages on demand. We want to budget the render, not the
    // one-off dev compile.
    await timeRender(page, cookieJar).catch(() => {});

    const durations = [];
    for (let run = 0; run < RUNS; run++) {
      durations.push(await timeRender(page, cookieJar));
    }
    durations.sort((a, b) => a - b);
    const best = durations[0];
    results.push({ page, budget, best, runs: durations, before: BEFORE[page] });
  }

  console.log('\nPage render benchmark (RSC navigation, seconds)');
  console.log('─'.repeat(88));
  console.log(
    'page'.padEnd(44) +
      'before'.padStart(8) +
      'after'.padStart(8) +
      'Δ'.padStart(8) +
      'budget'.padStart(8) +
      'status'.padStart(10),
  );
  console.log('─'.repeat(88));

  let failed = false;
  for (const { page, budget, best, before } of results) {
    const delta = before !== undefined ? best - before : NaN;
    const ok = best <= budget;
    if (!ok) failed = true;
    console.log(
      page.padEnd(44) +
        (before !== undefined ? before.toFixed(1) : '—').padStart(8) +
        best.toFixed(1).padStart(8) +
        (Number.isFinite(delta) ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '—').padStart(8) +
        `${budget}s`.padStart(8) +
        (ok ? '  ok'.padStart(10) : '  OVER'.padStart(10)),
    );
  }
  console.log('─'.repeat(88));

  if (BUDGET_MODE) {
    if (failed) {
      console.error('\n✗ Perf regression guard failed: at least one page exceeded its budget.');
      process.exit(1);
    }
    console.log('\n✓ Perf regression guard passed: all pages within budget.');
  } else {
    console.log('\n(benchmark only — rerun with --budget to enforce limits)');
  }
}

async function signIn() {
  const res = await fetch(`${BASE}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    console.error(`Sign-in failed (${res.status}) for ${EMAIL}`);
    process.exit(1);
  }
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookies
    .map((c) => c.split(';')[0])
    .filter((c) => /^[^=]+=.+/.test(c))
    .join('; ');
  if (!cookie) {
    console.error('Sign-in succeeded but no session cookie was returned.');
    process.exit(1);
  }
  return cookie;
}

async function resolveProgrammeDetailPath(cookie) {
  const res = await fetch(`${BASE}/api/programmes?limit=1`, {
    headers: { Cookie: cookie },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Programme benchmark discovery failed (${res.status}).`);
  }
  const json = await res.json();
  const id = json?.data?.[0]?.id;
  return id ? `/dashboard/programmes/${id}` : null;
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
        // A synthetic, stable router state tree is enough for the server to
        // stream the Flight payload (matching what the browser sends).
        'Next-Router-State-Tree': routerStateTree(path),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Page benchmark request failed for ${path} (${res.status}).`);
    }
    // fetch() resolves on response headers; the render cost is in the body.
    // Consume it so we time the full RSC render, matching the curl time_total
    // used for the before-baseline.
    await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
  return (performance.now() - started) / 1000;
}

/** Build a minimal but structurally valid router state tree for the path. */
function routerStateTree(path) {
  const segments = path.split('/').filter(Boolean);
  const tree = ['', { children: buildChildren(segments) }];
  return encodeURIComponent(JSON.stringify(tree));
}

function buildChildren(segments, index = 0) {
  if (index >= segments.length) {
    return ['__PAGE__', {}];
  }
  return [segments[index], { children: buildChildren(segments, index + 1) }];
}

main().catch((err) => {
  console.error('bench-pages failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
