import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { RESET_TABLE_CLASSIFICATION } from './reset-table-catalog';

describe('tenant reset table catalog coverage', () => {
  it('classifies every schema table exactly once', () => {
    const schemaTables = new Set<string>();
    for (const candidate of Object.values(schema)) {
      try {
        // Schema exports also include enums and relations; only tables resolve.
        const tableName = getTableName(candidate as never);
        if (typeof tableName === 'string' && tableName) schemaTables.add(tableName);
      } catch {
        // Not a table.
      }
    }
    const classified = Object.values(RESET_TABLE_CLASSIFICATION).flat();
    const counts = new Map<string, number>();
    classified.forEach((table) => counts.set(table, (counts.get(table) ?? 0) + 1));

    expect([...schemaTables].filter((table) => !counts.has(table))).toEqual([]);
    expect([...counts].filter(([, count]) => count !== 1)).toEqual([]);
    expect([...counts.keys()].filter((table) => !schemaTables.has(table))).toEqual([]);
  });

  it('keeps compliance history and recovery records protected', () => {
    expect(RESET_TABLE_CLASSIFICATION.protected).toEqual(
      expect.arrayContaining([
        'audit_events',
        'tenant_reset_requests',
        'reset_request_steps',
        'platform_backups',
      ]),
    );
  });
});
