import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
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
  const conditions: SQL[] = [eq(programmes.ownerUserId, userId)];
  if (employeeId) conditions.push(eq(programmes.ownerEmployeeId, employeeId));

  // createdByUserId records provenance, not perpetual ownership. Keep it only
  // as a compatibility fallback for legacy rows that pre-date explicit owner
  // fields; once either owner field is populated, ownership transfers cleanly.
  conditions.push(
    and(
      isNull(programmes.ownerUserId),
      isNull(programmes.ownerEmployeeId),
      eq(programmes.createdByUserId, userId),
    )!,
  );

  return or(...conditions)!;
}

export function isProgrammeOwnedByUser(
  programme: ProgrammeOwnershipRow,
  userId: string,
  employeeId: string | null,
) {
  if (programme.ownerUserId === userId) return true;
  if (employeeId && programme.ownerEmployeeId === employeeId) return true;
  return (
    programme.ownerUserId == null &&
    programme.ownerEmployeeId == null &&
    programme.createdByUserId === userId
  );
}