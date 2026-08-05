/**
 * Development Data Reset — reporting
 *
 * Renders a reset report (JSON + human-readable markdown) and records an
 * immutable audit event via the existing audit chain. Sensitive values
 * (passwords, tokens, hashes) are never included.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { recordAuditEvent } from '@/lib/audit-event';
import { REPORT_DIR } from './config';
import type { IntegrityCheck } from './integrity';

export interface StepOutcome {
  table: string;
  label: string;
  planned: number;
  removed: number;
}

export interface ResetReport {
  resetId: string;
  mode: string;
  dryRun: boolean;
  environment: string;
  database: string;
  timestamp: string;
  initiator: string;
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  confirmationPhraseProvided: boolean;
  backup?: {
    directory: string;
    records: number;
  };
  dryRunSummary: {
    requests: number;
    trips: number;
    documents: number;
    notifications: number;
    total: number;
  };
  steps: StepOutcome[];
  preserved: Array<{ table: string; label: string; count: number }>;
  review: Array<{ table: string; label: string; reason: string; count: number }>;
  storageFilesRemoved: string[];
  storageFilesSkipped: number;
  integrity: IntegrityCheck[];
  errors: string[];
  warnings: string[];
  result: 'completed' | 'dry_run' | 'failed';
}

/**
 * Persist the report to `data-reset-reports/` as JSON + markdown.
 * Returns the paths written.
 */
export async function writeReportFile(report: ResetReport): Promise<string[]> {
  const directory = path.join(REPORT_DIR);
  await mkdir(directory, { recursive: true });
  const base = path.join(directory, `${report.resetId}`);
  const jsonPath = `${base}.json`;
  const mdPath = `${base}.md`;

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, renderMarkdown(report), 'utf8');

  return [jsonPath, mdPath];
}

function renderMarkdown(report: ResetReport): string {
  const lines: string[] = [];
  lines.push(`# Development Data Reset — ${report.result.toUpperCase()}`);
  lines.push('');
  lines.push(`- **Reset ID:** ${report.resetId}`);
  lines.push(`- **Mode:** ${report.mode}`);
  lines.push(`- **Environment:** ${report.environment}`);
  lines.push(`- **Database host:** ${report.database}`);
  lines.push(`- **Tenant:** ${report.tenantName} (${report.tenantCode}) — ${report.tenantId}`);
  lines.push(`- **Timestamp:** ${report.timestamp}`);
  lines.push(`- **Initiator:** ${report.initiator}`);
  lines.push(`- **Dry-run:** ${report.dryRun ? 'yes' : 'no'}`);
  if (report.backup) {
    lines.push(`- **Backup:** ${report.backup.directory} (${report.backup.records} records)`);
  }
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Domain | Removed |');
  lines.push('| --- | ---: |');
  const summaryOrder: Array<[string, keyof ResetReport['dryRunSummary']]> = [
    ['Transport requests', 'requests'],
    ['Trips', 'trips'],
    ['Generated documents', 'documents'],
    ['Notifications', 'notifications'],
  ];
  for (const [label, key] of summaryOrder) {
    lines.push(`| ${label} | ${report.dryRunSummary[key]} |`);
  }
  lines.push('');

  lines.push('## Deletion steps');
  lines.push('');
  lines.push('| Table | Label | Planned | Removed |');
  lines.push('| --- | --- | ---: | ---: |');
  for (const step of report.steps) {
    lines.push(`| ${step.table} | ${step.label} | ${step.planned} | ${step.removed} |`);
  }
  lines.push('');

  lines.push('## Preserved');
  lines.push('');
  lines.push('| Domain | Count |');
  lines.push('| --- | ---: |');
  for (const item of report.preserved) {
    lines.push(`| ${item.label} (${item.table}) | ${item.count} |`);
  }
  lines.push('');

  if (report.review.some((item) => item.count > 0)) {
    lines.push('## Requires review (not deleted)');
    lines.push('');
    lines.push('| Table | Reason | Count |');
    lines.push('| --- | --- | ---: |');
    for (const item of report.review) {
      if (item.count > 0) {
        lines.push(`| ${item.label} (${item.table}) | ${item.reason} | ${item.count} |`);
      }
    }
    lines.push('');
  }

  lines.push('## Integrity checks');
  lines.push('');
  lines.push('| Check | Severity | Result |');
  lines.push('| --- | --- | --- |');
  for (const check of report.integrity) {
    const status = check.passed ? '✅ pass' : check.count === -1 ? '⚠️ error' : `❌ fail (${check.count})`;
    lines.push(`| ${check.label} | ${check.severity} | ${status} |`);
  }
  lines.push('');

  if (report.storageFilesRemoved.length > 0) {
    lines.push(`## Storage files removed (${report.storageFilesRemoved.length})`);
    lines.push('');
    for (const key of report.storageFilesRemoved) {
      lines.push(`- ${key}`);
    }
    lines.push('');
  }

  if (report.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const error of report.errors) lines.push(`- ${error}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create the reset audit event (immutable) using the existing audit chain.
 */
export async function recordResetAuditEvent(
  report: ResetReport,
  tenantId: string,
): Promise<void> {
  await recordAuditEvent({
    tenantId,
    actorUserId: report.initiator,
    action: 'development-data-reset',
    entityType: 'system',
    sourceChannel: report.dryRun ? 'cli' : 'cli',
    after: {
      resetId: report.resetId,
      mode: report.mode,
      dryRun: report.dryRun,
      environment: report.environment,
      database: report.database,
      result: report.result,
      deleted: report.dryRunSummary,
      storageFilesRemoved: report.storageFilesRemoved.length,
    },
    summary: `Development data reset (${report.mode}) for tenant ${report.tenantName} — result: ${report.result}`,
    reason: 'Controlled development data reset with explicit environment flag and confirmation phrase.',
  });
}
