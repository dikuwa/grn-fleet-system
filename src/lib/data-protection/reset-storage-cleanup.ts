import { sql } from 'drizzle-orm';
import { deleteFile, isStorageConfigured } from '@/lib/storage';
import { quoteTable } from '@/lib/data-reset/config';
import type { ResetDb } from '@/lib/data-reset/plan';
import type { AdvancedResetPlan } from './advanced-reset-plan';

function storageKeysFromValue(value: unknown): string[] {
  if (typeof value === 'string') {
    const key = value.trim();
    return key ? [key] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => storageKeysFromValue(item));
  }
  return [];
}

/**
 * Collect file keys for rows selected by the advanced/selective reset plan.
 * This must run before the database mutation because the owning rows no longer
 * exist after a successful reset.
 */
export async function collectAdvancedResetStorageKeys(
  db: ResetDb,
  plan: AdvancedResetPlan,
): Promise<string[]> {
  const keys: string[] = [];

  for (const step of plan.steps) {
    if (!step.before || !step.fileKeyColumns?.length) continue;
    const selectColumns = step.fileKeyColumns.join(', ');
    const result = await db.execute(
      sql`SELECT ${sql.raw(selectColumns)} FROM ${sql.raw(quoteTable(step.table))} WHERE ${step.condition}`,
    );
    for (const row of result.rows ?? []) {
      for (const column of step.fileKeyColumns) {
        keys.push(...storageKeysFromValue(row[column]));
      }
    }
  }

  return [...new Set(keys)];
}

/**
 * Delete reset-owned objects only after the matching database mutation has
 * committed. Storage failures do not make a completed database reset unsafe to
 * retry; failed keys are returned as preserved so operators retain an explicit
 * cleanup trail instead of losing visibility of orphaned objects.
 */
export async function removeApprovedResetStorageFiles(fileKeys: string[]): Promise<{
  removed: string[];
  preserved: string[];
}> {
  const uniqueKeys = [...new Set(fileKeys.filter((key) => key.trim().length > 0))];
  if (!uniqueKeys.length) return { removed: [], preserved: [] };
  if (!isStorageConfigured()) return { removed: [], preserved: uniqueKeys };

  const removed: string[] = [];
  const preserved: string[] = [];
  for (const key of uniqueKeys) {
    try {
      await deleteFile(key);
      removed.push(key);
    } catch (error) {
      console.error(`[Tenant Reset] Could not remove storage object ${key}:`, error);
      preserved.push(key);
    }
  }
  return { removed, preserved };
}
