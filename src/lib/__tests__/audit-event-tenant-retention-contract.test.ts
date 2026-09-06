import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  resolve(process.cwd(), 'src/db/schema/audit.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0116_audit_event_tenant_retention.sql'),
  'utf8',
);

describe('audit event tenant retention', () => {
  it('keeps the historical tenant UUID non-null without a cascading tenant foreign key', () => {
    const auditTable = schema.indexOf("export const auditEvents = pgTable('audit_events'");
    const tenantId = schema.indexOf("tenantId: uuid('tenant_id').notNull()", auditTable);

    expect(auditTable).toBeGreaterThan(-1);
    expect(tenantId).toBeGreaterThan(auditTable);
    expect(schema.slice(auditTable)).not.toContain("references(() => tenants.id, { onDelete: 'cascade' })");
  });

  it('drops the legacy cascading audit-events tenant constraint without deleting tenant ids', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "audit_events_tenant_id_tenants_id_fk"');
    expect(migration).not.toMatch(/DROP\s+COLUMN\s+"?tenant_id"?/i);
    expect(migration).not.toMatch(/SET\s+"?tenant_id"?\s*=\s*NULL/i);
  });
});
