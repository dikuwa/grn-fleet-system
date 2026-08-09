import { and, eq, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { programmes } from '@/db/schema/programmes';
import { getSessionWorkspace, type AuthSession } from '@/lib/auth-helpers';
import { WorkspaceIds } from '@/lib/workspaces';

export type ProgrammeOwnershipRow = {
  createdByUserId: string | null;
  ownerUserId: string | null;
  ownerEmployeeId: string | null;
};

export async function resolveProgrammeAccess(session: AuthSession) {
  const db = getDb();
  const workspace = await getSessionWorkspace(session);
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, session.tenantId), eq(employees.userId, session.user.id)))
    .limit(1);

  return {
    tenantWide: workspace.activeWorkspace === WorkspaceIds.TENANT_ADMIN,
    employeeId: employee?.id ?? null,
  };
}

export function programmeOwnershipCondition(
  userId: string,
  employeeId: string | null,
): SQL {
  const conditions: SQL[] = [
    eq(programmes.createdByUserId, userId),
    eq(programmes.ownerUserId, userId),
  ];
  if (employeeId) conditions.push(eq(programmes.ownerEmployeeId, employeeId));
  return or(...conditions)!;
}

export function isProgrammeOwnedByUser(
  programme: ProgrammeOwnershipRow,
  userId: string,
  employeeId: string | null,
) {
  return (
    programme.createdByUserId === userId ||
    programme.ownerUserId === userId ||
    Boolean(employeeId && programme.ownerEmployeeId === employeeId)
  );
}
