import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { maintenanceScopeCondition } from '@/lib/record-scope';

const dialect = new PgDialect();

function renderScope(recordScope: 'tenant' | 'assigned' | 'self' | 'related') {
  return dialect
    .sqlToQuery(
      maintenanceScopeCondition({
        tenantId: '11111111-1111-1111-1111-111111111111',
        userId: 'maintenance-user',
        recordScope,
      }),
    )
    .sql.toLowerCase()
    .replaceAll('"', '');
}

describe('maintenance record scope', () => {
  it('surfaces unassigned maintenance follow-ups in the assigned Maintenance queue', () => {
    const sql = renderScope('assigned');

    expect(sql).toContain('maintenance_events.assigned_to_user_id is null');
    expect(sql).toContain('maintenance_events.assigned_to_user_id');
    expect(sql).toContain('maintenance_events.created_by_user_id');
  });

  it('does not broaden stricter non-assigned scopes to every unassigned maintenance row', () => {
    expect(renderScope('self')).not.toContain('assigned_to_user_id is null');
    expect(renderScope('related')).not.toContain('assigned_to_user_id is null');
  });
});
