/**
 * Read-only smoke test for the production reset catalog.
 * Builds every supported plan for one tenant and never executes a delete.
 */
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { previewTenantOperationalReset } from '@/lib/data-protection/reset-service';
import { exportAdvancedResetRows } from '@/lib/data-protection/advanced-reset-plan';
import { sql } from 'drizzle-orm';

const cases = [
  ['operational', { preset: 'operational' }],
  ['documents', { preset: 'selective', categories: ['documents'] }],
  ['programmes', { preset: 'selective', categories: ['programmes'] }],
  ['fleet', { preset: 'selective', categories: ['fleet'] }],
  ['people', { preset: 'selective', categories: ['people'] }],
  ['organisation', { preset: 'selective', categories: ['organisation'] }],
  ['access', { preset: 'selective', categories: ['access'] }],
  ['configuration', { preset: 'selective', categories: ['configuration'] }],
  ['clean_slate', { preset: 'clean_slate' }],
] as const;

async function main() {
  const db = getDb();
  const [tenant] = await db.select({ id: tenants.id, code: tenants.code }).from(tenants).limit(1);
  if (!tenant) throw new Error('No tenant is available for reset-plan verification');

  const requestedCase = process.argv.find((argument) => argument.startsWith('--case='))?.slice(7);
  const selectedCases = requestedCase ? cases.filter(([label]) => label === requestedCase) : cases;
  if (!selectedCases.length) throw new Error(`Unknown reset verification case: ${requestedCase}`);

  for (const [label, resetSpec] of selectedCases) {
    const { preview, plan, advancedPlan } = await previewTenantOperationalReset(
      tenant.id,
      resetSpec,
    );
    console.log(
      JSON.stringify({
        tenant: tenant.code,
        label,
        categories: preview.resetSpec.categories,
        plannedRows: preview.dryRunSummary.total,
        nonEmptySteps: preview.steps.filter((step) => step.planned > 0).length,
      }),
    );

    if (process.argv.includes('--check-fks')) {
      const orderedTables = [
        ...(preview.resetSpec.categories.includes('operations')
          ? plan.steps.map((step) => step.table)
          : []),
        ...advancedPlan.steps.map((step) => step.table),
      ];
      const positions = new Map<string, number>();
      orderedTables.forEach((table, index) => {
        if (!positions.has(table)) positions.set(table, index);
      });
      const constraints = await db.execute(sql`
        SELECT child.relname AS child_table, parent.relname AS parent_table,
          CASE constraint_row.confdeltype WHEN 'a' THEN 'no_action' WHEN 'r' THEN 'restrict' END AS on_delete
        FROM pg_constraint constraint_row
        JOIN pg_class child ON child.oid = constraint_row.conrelid
        JOIN pg_class parent ON parent.oid = constraint_row.confrelid
        JOIN pg_namespace namespace_row ON namespace_row.oid = child.relnamespace
        WHERE constraint_row.contype = 'f'
          AND constraint_row.confdeltype IN ('a', 'r')
          AND namespace_row.nspname = 'public'
      `);
      const violations = constraints.rows.filter((row) => {
        const parentPosition = positions.get(String(row.parent_table));
        if (parentPosition === undefined) return false;
        const childPosition = positions.get(String(row.child_table));
        return childPosition === undefined || childPosition > parentPosition;
      });
      if (violations.length) {
        throw new Error(`Unsafe foreign-key reset order: ${JSON.stringify(violations)}`);
      }
      console.log(JSON.stringify({ label, foreignKeyOrder: 'verified' }));
    }

    if (process.argv.includes('--check-export')) {
      const exported = await exportAdvancedResetRows(advancedPlan);
      const exportedRows = exported.reduce((total, table) => total + table.rows.length, 0);
      if (exportedRows !== advancedPlan.total) {
        throw new Error(
          `Advanced backup export mismatch: planned ${advancedPlan.total}, exported ${exportedRows}`,
        );
      }
      console.log(JSON.stringify({ label, advancedBackupRows: exportedRows, export: 'verified' }));
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
