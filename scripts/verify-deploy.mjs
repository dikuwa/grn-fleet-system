#!/usr/bin/env node
/**
 * verify-deploy.mjs
 *
 * Auto-verify that the latest pushed commit is deployed and healthy:
 *   1. Resolve the git HEAD commit (or the commit given via --sha).
 *   2. Poll the GitHub deployment status API until a deployment for that
 *      commit reaches state "success"/"ready" (or times out).
 *   3. Health-check the live app: landing responds and the sign-in endpoint
 *      returns a valid session.
 *
 * Usage:
 *   node scripts/verify-deploy.mjs                 # use local HEAD
 *   node scripts/verify-deploy.mjs --sha <sha>     # verify a specific commit
 *   node scripts/verify-deploy.mjs --timeout 600   # poll up to 600s (default 300)
 *
 * Env:
 *   GITHUB_TOKEN      optional — required only for private repos (rate limits)
 *   REPO              default "dikuwa/grn-fleet-system"
 *   LIVE_URL          default "https://grn-fleet-system.vercel.app"
 *   LOGIN_EMAIL       default "requester@kavangoeast.test"
 *   LOGIN_PASSWORD    default "changeme"
 *
 * Exit codes: 0 = deployed + healthy, 1 = not deployed / unhealthy.
 */
import { execSync } from 'node:child_process';

const REPO = process.env.REPO || 'dikuwa/grn-fleet-system';
const LIVE_URL = (process.env.LIVE_URL || 'https://grn-fleet-system.vercel.app').replace(/\/$/, '');
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || 'requester@kavangoeast.test';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'changeme';
const AUTH_HEADER = process.env.GITHUB_TOKEN
  ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : {};

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function shaFromArgs() {
  const idx = process.argv.indexOf('--sha');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    fail('Could not resolve git HEAD. Run from the repo root or pass --sha.');
  }
}

async function ghJson(url, signal) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', ...AUTH_HEADER }, signal });
  if (!res.ok) throw new Error(`GitHub ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function findDeploymentForCommit(sha) {
  // List deployments for the commit, newest first.
  const deployments = await ghJson(
    `https://api.github.com/repos/${REPO}/deployments?sha=${sha}&per_page=10`,
  );
  const candidate =
    deployments.find((d) => (d.environment || '').toLowerCase().includes('production')) ||
    deployments[0];
  if (!candidate) return null;
  return candidate;
}

async function deploymentState(deploymentId) {
  const statuses = await ghJson(
    `https://api.github.com/repos/${REPO}/deployments/${deploymentId}/statuses?per_page=5`,
  );
  return statuses[0] || null;
}

async function healthCheck() {
  const landing = await fetch(LIVE_URL, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const landingOk = [200, 307, 308].includes(landing.status);
  console.log(`  Landing: HTTP ${landing.status}${landingOk ? ' ✓' : ' (redirect is expected)'}`);

  const login = await fetch(`${LIVE_URL}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    signal: AbortSignal.timeout(25_000),
  });
  const body = await login.json().catch(() => ({}));
  const token = body.token || body.session?.token;
  const loginOk = login.status === 200 && Boolean(token);
  console.log(`  Login: HTTP ${login.status} ${loginOk ? '✓' : '✗'}`);
  return loginOk;
}

async function main() {
  const sha = shaFromArgs();
  const timeoutSeconds = Number(
    process.argv[process.argv.indexOf('--timeout') + 1] || process.env.DEPLOY_POLL_TIMEOUT || 300,
  );
  console.log(`Verifying deploy for commit ${sha.slice(0, 12)} (repo ${REPO})…`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  let deployed = false;
  let lastState = 'unknown';

  while (Date.now() < deadline) {
    try {
      const deployment = await findDeploymentForCommit(sha);
      if (!deployment) {
        console.log('  No deployment found for this commit yet…');
      } else {
        const status = await deploymentState(deployment.id);
        lastState = status?.state || 'pending';
        console.log(`  Deployment ${deployment.id}: ${lastState}`);
        if (['success', 'ready'].includes(lastState)) {
          deployed = true;
          break;
        }
        if (['error', 'failure', 'inactive'].includes(lastState)) {
          fail(`Deployment ${deployment.id} ended in state "${lastState}".`);
        }
      }
    } catch (err) {
      console.log(`  Poll error (${err.message}); retrying…`);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }

  if (!deployed) {
    fail(`No successful deployment for ${sha.slice(0, 12)} within ${timeoutSeconds}s (last state: ${lastState}).`);
  }

  console.log('Deployment confirmed. Running live health check…');
  if (!(await healthCheck())) {
    fail('Live health check failed (login did not return a session token).');
  }

  console.log(`✅ ${sha.slice(0, 12)} is deployed (${lastState}) and the live app is healthy.`);
  process.exit(0);
}

main().catch((err) => fail(err.message));
