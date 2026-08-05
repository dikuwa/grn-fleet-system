/**
 * Development Data Reset — CLI
 *
 * Controlled, tenant-aware reset of development/demo operational data while
 * preserving users, roles, staff, tenants, configuration and vehicles.
 *
 * Usage:
 *   pnpm data-reset:dry-run                       # operational mode, selected tenant
 *   pnpm data-reset:execute -- --confirm="RESET GRN FLEET DEVELOPMENT DATA"
 *   pnpm data-reset:dry-run -- --tenant=<id>      # another tenant
 *   pnpm data-reset:demo-accounts:dry-run         # list demo accounts for review
 *   pnpm data-reset:demo-vehicles:dry-run         # list E2E demo vehicles
 *   pnpm data-reset:demo-vehicles:execute -- --confirm="RESET GRN FLEET DEVELOPMENT DATA"
 *
 * Safety:
 *   - Blocked when NODE_ENV/VERCEL_ENV (etc.) indicate production.
 *   - Requires ALLOW_DEV_DATA_RESET=true in the environment.
 *   - Executes only with the exact confirmation phrase.
 *   - Every deletion is scoped to the selected tenant.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '@/db';
import {
  BACKUP_DIR,
  DATA_RESET_CONFIRMATION_PHRASE,
  DATA_RESET_ENV_FLAG,
  SEED_TENANT_ID,
  type ResetMode,
} from '@/lib/data-reset/config';
import { checkResetAllowed } from '@/lib/data-reset/guard';
import { runDevelopmentDataReset } from '@/lib/data-reset/engine';
import {
  listDemoAccounts,
  listDemoVehicles,
  deleteDemoVehicles,
  deleteDemoAccounts,
} from '@/lib/data-reset/demo';
import type { ResetDb } from '@/lib/data-reset/plan';
import { recordAuditEvent } from '@/lib/audit-event';

interface CliArgs {
  mode: ResetMode;
  dryRun: boolean;
  tenantId: string;
  confirm?: string;
  ids?: string[];
  initiator?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: 'operational',
    dryRun: false,
    tenantId: SEED_TENANT_ID,
  };

  for (const raw of argv) {
    const arg = raw.startsWith('--') ? raw : `--${raw}`;
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    const value = rest.join('=');
    switch (key) {
      case 'mode':
        if (value !== 'operational' && value !== 'demo-accounts' && value !== 'demo-vehicles') {
          throw new Error(`Unknown mode "${value}". Use operational | demo-accounts | demo-vehicles.`);
        }
        args.mode = value;
        break;
      case 'tenant':
        if (!UUID_RE.test(value)) {
          throw new Error(`Invalid tenant id "${value}". Expected a UUID.`);
        }
        args.tenantId = value;
        break;
      case 'confirm':
        args.confirm = value;
        break;
      case 'initiator':
        args.initiator = value;
        break;
      case 'ids':
        args.ids = value
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        break;
      case 'dry-run':
      case 'dryrun':
        args.dryRun = true;
        break;
      case 'execute':
        args.dryRun = false;
        break;
      case 'help':
      case 'h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument "${raw}". Run with --help.`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
Development Data Reset — GRN Fleet Management

Commands:
  data-reset:dry-run                      Operational dry-run (default tenant)
  data-reset:execute                      Operational execute (requires confirmation)
  data-reset:demo-accounts:dry-run        List demo accounts for review
  data-reset:demo-accounts:execute        Delete explicitly approved demo accounts
  data-reset:demo-vehicles:dry-run        List E2E demo vehicles
  data-reset:demo-vehicles:execute        Delete E2E demo vehicles

Arguments:
  --tenant=<uuid>     Target tenant (default: seed tenant)
  --mode=<mode>       operational | demo-accounts | demo-vehicles
  --dry-run | --execute
  --confirm="<phrase>"  Required for execute: ${DATA_RESET_CONFIRMATION_PHRASE}
  --ids=<id,id>       Explicit ids (from the dry-run) for demo-account/vehicle execution
  --initiator=<id>    Audit initiator user id (default: cli)

Environment:
  ${DATA_RESET_ENV_FLAG}=true   Required (never set in production)
`);
}

// ---------------------------------------------------------------------------
// Readable console output
// ---------------------------------------------------------------------------

function printPlanSummary(
  report: {
    tenantName: string;
    tenantId: string;
    database: string;
    dryRunSummary: { requests: number; trips: number; documents: number; notifications: number; total: number };
    steps: Array<{ table: string; label: string; planned: number; removed: number }>;
    preserved: Array<{ table: string; label: string; count: number }>;
    review: Array<{ table: string; label: string; reason: string; count: number }>;
    fileKeys?: number;
  },
): void {
  console.log('────────────────────────────────────────────────────────────');
  console.log(`Tenant:    ${report.tenantName}`);
  console.log(`Tenant ID: ${report.tenantId}`);
  console.log(`Database:  ${report.database}`);
  console.log('────────────────────────────────────────────────────────────');
  console.log(`Transport requests:  ${report.dryRunSummary.requests}`);
  console.log(`Trips:               ${report.dryRunSummary.trips}`);
  console.log(`Generated documents: ${report.dryRunSummary.documents}`);
  console.log(`Notifications:       ${report.dryRunSummary.notifications}`);
  console.log(`Total rows planned:  ${report.dryRunSummary.total}`);
  console.log('');
  console.log('Deletion steps:');
  for (const step of report.steps) {
    console.log(`  ${step.table.padEnd(30)} ${String(step.planned).padStart(6)}`);
  }
  console.log('');
  const reviewItems = report.review.filter((item) => item.count > 0);
  if (reviewItems.length > 0) {
    console.log('Requires review (not deleted automatically):');
    for (const item of reviewItems) {
      console.log(`  ${item.label.padEnd(26)} ${String(item.count).padStart(6)}  — ${item.reason}`);
    }
    console.log('');
  }
  const preservedActive = report.preserved.filter((item) =>
    ['Auth users', 'Staff', 'Vehicles', 'Roles', 'Role assignments', 'Tenants', 'Offices', 'Departments', 'Driver licences'].includes(item.label),
  );
  console.log('Preserved (selected):');
  for (const item of preservedActive) {
    console.log(`  ${item.label.padEnd(26)} ${String(item.count).padStart(6)}`);
  }
}

// ---------------------------------------------------------------------------
// Mode handlers
// ---------------------------------------------------------------------------

async function handleOperational(args: CliArgs): Promise<void> {
  const outcome = await runDevelopmentDataReset({
    tenantId: args.tenantId,
    mode: 'operational',
    dryRun: args.dryRun,
    confirmPhrase: args.confirm,
    initiator: args.initiator,
  });
  const report = outcome.report;

  if (report.result === 'failed' && report.errors.length > 0 && !report.tenantName) {
    console.error('❌ Reset blocked:');
    for (const error of report.errors) console.error(`   - ${error}`);
    console.error('\nRun the dry-run with ALLOW_DEV_DATA_RESET=true, then execute with:');
    console.error(`   pnpm data-reset:execute -- --confirm="${DATA_RESET_CONFIRMATION_PHRASE}"`);
    process.exitCode = 1;
    return;
  }

  printPlanSummary(report);

  if (report.dryRun) {
    console.log('\n✅ Dry-run complete — nothing was deleted.');
    console.log('Run the executable reset with:');
    console.log(`   ALLOW_DEV_DATA_RESET=true pnpm data-reset:execute -- --confirm="${DATA_RESET_CONFIRMATION_PHRASE}"`);
    return;
  }

  console.log('');
  console.log('Execution result:');
  if (report.backup) console.log(`   Backup: ${report.backup.directory} (${report.backup.records} records)`);
  for (const error of report.errors) console.log(`   ⚠️ ${error}`);
  console.log(`   Storage files removed: ${report.storageFilesRemoved.length} (skipped: ${report.storageFilesSkipped})`);
  const failedChecks = report.integrity.filter((check) => !check.passed);
  console.log(`   Integrity: ${report.integrity.length - failedChecks.length}/${report.integrity.length} checks passed`);
  for (const check of failedChecks) {
    console.log(`     ❌ ${check.label} (${check.count})`);
  }
  console.log(`   Result: ${report.result.toUpperCase()}`);
  if (report.result === 'completed') {
    console.log('✅ Reset completed successfully.');
  } else {
    console.log('❌ Reset did not complete cleanly. Inspect the report and re-run the dry-run.');
    process.exitCode = 1;
  }
}

async function handleDemoAccounts(args: CliArgs): Promise<void> {
  const db = getDb() as unknown as ResetDb;
  const { proposed, preserved } = await listDemoAccounts(db, args.tenantId);

  console.log('────────────────────────────────────────────────────────────');
  console.log('Demo account review (Mode B)');
  console.log('────────────────────────────────────────────────────────────');
  if (proposed.length === 0) {
    console.log('No disposable demo accounts found. Every seed account is preserved');
    console.log('because it has roles, a staff link, or tenant membership.');
  } else {
    console.log('Proposed for deletion (requires explicit approval):');
    for (const account of proposed) {
      console.log(`  ${account.email} (${account.userId})`);
    }
  }
  console.log('');
  console.log(`Preserved demo/seed accounts (with roles/staff): ${preserved.length}`);
  for (const account of preserved.slice(0, 30)) {
    console.log(`  ✓ ${account.email}${account.reasons.length ? `  (${account.reasons.join('; ')})` : ''}`);
  }
  if (preserved.length > 30) console.log(`  … and ${preserved.length - 30} more`);

  // Dry-run ends here.
  if (args.dryRun) {
    if (proposed.length > 0) {
      console.log('\nTo delete, re-run with explicit ids:');
      console.log(`  pnpm data-reset:demo-accounts:execute -- --tenant=${args.tenantId} --ids=${proposed.map((a) => a.userId).join(',')} --confirm="${DATA_RESET_CONFIRMATION_PHRASE}"`);
    }
    return;
  }

  // Execute: explicit ids + confirmation phrase required.
  if (!args.ids || args.ids.length === 0) {
    console.error('❌ Demo-account deletion requires an explicit --ids list (from the dry-run).');
    process.exitCode = 1;
    return;
  }
  if (args.confirm !== DATA_RESET_CONFIRMATION_PHRASE) {
    console.error(`❌ Confirmation phrase missing or incorrect. Use --confirm="${DATA_RESET_CONFIRMATION_PHRASE}"`);
    process.exitCode = 1;
    return;
  }

  // Backup before deletion (spec §2.3).
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(BACKUP_DIR, 'demo-accounts', timestamp);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'proposed-accounts.json'),
    JSON.stringify({ tenantId: args.tenantId, timestamp, accounts: proposed }, null, 2),
    'utf8',
  );
  console.log(`\n💾 Backup written: ${directory}/proposed-accounts.json`);

  const result = await deleteDemoAccounts(db, args.tenantId, args.ids);
  for (const blockedItem of result.blocked) {
    console.warn(`   ⚠️ Blocked: ${blockedItem.userId} — ${blockedItem.reason}`);
  }
  console.log(`✅ Deleted ${result.deleted} demo account(s).`);

  await recordAuditEvent({
    tenantId: args.tenantId,
    actorUserId: args.initiator ?? 'cli',
    action: 'development-data-reset.demo-accounts',
    entityType: 'user',
    after: { deleted: result.deleted, blocked: result.blocked.length, backup: directory },
    summary: `Deleted ${result.deleted} explicitly approved demo accounts`,
    reason: 'Explicitly requested demo-account cleanup with confirmation phrase and approved ids.',
  });
  if (result.blocked.length > 0) process.exitCode = 1;
}

async function handleDemoVehicles(args: CliArgs): Promise<void> {
  const db = getDb() as unknown as ResetDb;
  const vehicles = await listDemoVehicles(db, args.tenantId);

  console.log('────────────────────────────────────────────────────────────');
  console.log('Demo vehicles (E2E-marked licence plates)');
  console.log('────────────────────────────────────────────────────────────');
  if (vehicles.length === 0) {
    console.log('No demo vehicles found.');
    return;
  }
  for (const vehicle of vehicles) {
    const marker = vehicle.hasOperationalRecords ? ' ⚠️ has operational records' : '';
    console.log(`  ${vehicle.licenceNumber} (${vehicle.make} ${vehicle.model ?? ''}, ${vehicle.status ?? 'unknown'})${marker}`);
  }

  if (args.dryRun) {
    console.log('\n✅ Dry-run — nothing was deleted. To delete:');
    console.log(`   ALLOW_DEV_DATA_RESET=true pnpm data-reset:demo-vehicles:execute -- --ids=${vehicles.map((v) => v.id).join(',')} --confirm="${DATA_RESET_CONFIRMATION_PHRASE}"`);
    return;
  }

  const allowed = checkResetAllowed();
  const confirmOk = args.confirm === DATA_RESET_CONFIRMATION_PHRASE;
  if (!allowed.allowed || !confirmOk) {
    console.error('❌ Blocked. Set ALLOW_DEV_DATA_RESET=true and supply the exact confirmation phrase.');
    process.exitCode = 1;
    return;
  }

  const idsToDelete = args.ids && args.ids.length > 0 ? args.ids : vehicles.map((v) => v.id);

  // Backup before deletion (spec §2.3).
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(BACKUP_DIR, 'demo-vehicles', timestamp);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'demo-vehicles.json'),
    JSON.stringify({ tenantId: args.tenantId, timestamp, vehicles }, null, 2),
    'utf8',
  );
  console.log(`💾 Backup written: ${directory}/demo-vehicles.json`);

  const result = await deleteDemoVehicles(db, args.tenantId, idsToDelete);
  console.log('');
  if (result.blocked.length > 0) {
    console.log('⚠️ Blocked vehicles (run the operational reset first):');
    for (const message of result.blocked) console.log(`   - ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ Deleted ${result.deleted} demo vehicle(s).`);
    await recordAuditEvent({
      tenantId: args.tenantId,
      actorUserId: args.initiator ?? 'cli',
      action: 'development-data-reset.demo-vehicles',
      entityType: 'vehicle',
      after: { deleted: result.deleted, backup: directory },
      summary: `Deleted ${result.deleted} explicitly marked demo vehicles`,
      reason: 'Explicitly requested demo-vehicle cleanup with confirmation phrase.',
    });
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allowed = checkResetAllowed();
  if (!allowed.allowed) {
    console.error('❌ Development data reset is blocked:');
    for (const error of allowed.errors) console.error(`   - ${error}`);
    console.error('\nThis tool is for development/staging databases only.');
    process.exitCode = 1;
    return;
  }
  for (const warning of allowed.warnings) console.warn(`⚠️ ${warning}`);

  switch (args.mode) {
    case 'operational':
      await handleOperational(args);
      break;
    case 'demo-accounts':
      await handleDemoAccounts(args);
      break;
    case 'demo-vehicles':
      await handleDemoVehicles(args);
      break;
  }
}

main().catch((error: unknown) => {
  console.error('❌ Data reset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
