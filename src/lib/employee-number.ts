import { sql } from 'drizzle-orm';
import { employeeNumberCounters, employees, tenants } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { getDb } from '@/db';

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

function sanitisePrefix(value: string | undefined) {
  return (value || 'EMP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'EMP';
}

export async function allocateEmployeeNumber(tx: Transaction, tenantId: string) {
  const [tenant] = await tx
    .select({ code: tenants.code, metadata: tenants.metadata })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) throw new Error('Tenant not found while allocating employee number.');

  const configuredPrefix = typeof tenant.metadata?.employeeNumberPrefix === 'string'
    ? tenant.metadata.employeeNumberPrefix
    : undefined;
  const prefix = sanitisePrefix(configuredPrefix || tenant.code);
  for (let attempt = 0; attempt < 100; attempt++) {
    const [counter] = await tx
      .insert(employeeNumberCounters)
      .values({ tenantId, nextValue: 1 })
      .onConflictDoUpdate({
        target: employeeNumberCounters.tenantId,
        set: {
          nextValue: sql`${employeeNumberCounters.nextValue} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ value: employeeNumberCounters.nextValue });
    const candidate = `${prefix}${String(counter.value).padStart(3, '0')}`;
    const [existing] = await tx.select({ id: employees.id }).from(employees).where(and(
      eq(employees.tenantId, tenantId), eq(employees.employeeNumber, candidate),
    )).limit(1);
    if (!existing) return candidate;
  }
  throw new Error('Unable to allocate a unique employee number after 100 attempts.');
}
