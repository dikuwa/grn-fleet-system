import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const verifier = readFileSync('scripts/verify-deploy.mjs', 'utf8');
const demoSeedGuard = readFileSync('scripts/run-demo-seed.mjs', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const adminSeed = readFileSync('src/seed/seed-users.ts', 'utf8');

describe('production credential hardening', () => {
  it('never defaults deploy verification to changeme', () => {
    expect(verifier).not.toContain("process.env.LOGIN_PASSWORD || 'changeme'");
    expect(verifier).toContain("const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || ''");
    expect(verifier).toContain('/api/auth/get-session');
    expect(verifier).toContain('Credential sign-in: skipped');
  });

  it('only performs credential sign-in when explicit credentials exist', () => {
    expect(verifier).toContain('if (!LOGIN_EMAIL || !LOGIN_PASSWORD)');
    expect(verifier).toContain('/api/auth/sign-in');
  });

  it('routes the supported demo seed command through a production guard', () => {
    expect(packageJson).toContain('"db:seed:demo": "node scripts/run-demo-seed.mjs"');
    expect(demoSeedGuard).toContain("process.env.NODE_ENV === 'production'");
    expect(demoSeedGuard).toContain("process.env.VERCEL_ENV === 'production'");
    expect(demoSeedGuard).toContain('SEED_ADMIN_PASSWORD must be explicitly configured');
    expect(demoSeedGuard).toContain("['exec', 'tsx', 'src/seed/index.ts']");
  });

  it('blocks the standalone admin seed from defaulting credentials in production', () => {
    expect(adminSeed).toContain("process.env.NODE_ENV === 'production'");
    expect(adminSeed).toContain("process.env.VERCEL_ENV === 'production'");
    expect(adminSeed).toContain('SEED_ADMIN_PASSWORD must be explicitly configured in production.');
    expect(adminSeed).not.toContain('Password: ${adminPassword}');
  });
});
