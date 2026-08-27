import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { quoteTable } from './config';
import type { ResetPlan } from './plan';
import type { AdvancedResetPlan } from '@/lib/data-protection/advanced-reset-plan';
import { deleteFile, isStorageConfigured } from '@/lib/storage';

function extractKeys(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
      }
    } catch {
      // Fall through to comma-separated legacy storage below.
    }
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Capture every selected file key while the reset rows still exist. Operational
 * keys are already collected by the core plan; advanced/selective categories
 * expose their key columns on each planned step and are collected here using
 * the exact same WHERE condition that will be deleted.
 */
export async function collectResetStorageKeys(
  operationalPlan: ResetPlan,
  advancedPlan: AdvancedResetPlan,
) {
  const db = getDb();
  const keys = new Set(operationalPlan.fileKeys);

  for (const step of advancedPlan.steps) {
    if (!step.before || !step.fileKeyColumns?.length) continue;
    const columns = step.fileKeyColumns.join(', ');
    const result = await db.execute(
      sql`SELECT ${sql.raw(columns)} FROM ${sql.raw(quoteTable(step.table))} WHERE ${step.condition}`,
    );
    for (const row of result.rows ?? []) {
      for (const column of step.fileKeyColumns) {
        for (const key of extractKeys((row as Record<string, unknown>)[column])) keys.add(key);
      }
    }
  }

  return [...keys];
}

/**
 * Storage cleanup is deliberately post-commit: an R2 deletion can never happen
 * before the governed database reset has succeeded. Object cleanup failures are
 * returned to the caller for audit/reporting instead of being misreported as
 * deleted or causing database history to claim the reset rolled back.
 */
export async function deleteResetStorageKeys(keys: string[]) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (!isStorageConfigured()) {
    return {
      configured: false,
      planned: uniqueKeys.length,
      removed: 0,
      failed: [] as Array<{ key: string; error: string }>,
      preserved: uniqueKeys.length,
    };
  }

  const settled = await Promise.allSettled(uniqueKeys.map((key) => deleteFile(key)));
  const failed: Array<{ key: string; error: string }> = [];
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      failed.push({
        key: uniqueKeys[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return {
    configured: true,
    planned: uniqueKeys.length,
    removed: uniqueKeys.length - failed.length,
    failed,
    preserved: failed.length,
  };
}
