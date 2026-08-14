import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalParties } from '@/db/schema/external-parties';
import { transportRequests } from '@/db/schema/requests';
import { departments, employees, offices } from '@/db/schema/people';

export type ResolvedRequestIdentity = {
  requesterType: 'internal' | 'external';
  requester: {
    id: string | null;
    name: string;
    employeeNumber?: string | null;
    designation?: string | null;
    department?: string | null;
    office?: string | null;
    organisation?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  routingContact: {
    employeeId: string;
    name: string;
    employeeNumber?: string | null;
    designation?: string | null;
    department?: string | null;
    office?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
};

/**
 * Resolve the human requester represented by a transport request without
 * conflating workflow routing with identity.
 *
 * Internal requests resolve requesterEmployeeId as before. External requests
 * resolve externalRequesterId as the requester and expose requesterEmployeeId
 * only as the responsible internal routing contact.
 */
export async function resolveRequestIdentity(
  requestId: string,
  tenantId?: string,
): Promise<ResolvedRequestIdentity | null> {
  const db = getDb();
  const conditions = [eq(transportRequests.id, requestId)];
  if (tenantId) conditions.push(eq(transportRequests.tenantId, tenantId));

  const [request] = await db
    .select({
      tenantId: transportRequests.tenantId,
      requesterType: transportRequests.requesterType,
      requesterEmployeeId: transportRequests.requesterEmployeeId,
      externalRequesterId: transportRequests.externalRequesterId,
      fallbackDepartment: transportRequests.department,
    })
    .from(transportRequests)
    .where(and(...conditions))
    .limit(1);
  if (!request) return null;

  const [routingEmployee] = request.requesterEmployeeId
    ? await db
        .select({
          id: employees.id,
          name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.middleName}, ${employees.lastName})`,
          employeeNumber: employees.employeeNumber,
          designation: employees.jobTitle,
          phone: employees.phone,
          email: employees.email,
          department: departments.name,
          office: offices.name,
        })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .leftJoin(offices, eq(offices.id, employees.officeId))
        .where(
          and(
            eq(employees.id, request.requesterEmployeeId),
            eq(employees.tenantId, request.tenantId),
          ),
        )
        .limit(1)
    : [];

  const routingContact = routingEmployee
    ? {
        employeeId: routingEmployee.id,
        name: routingEmployee.name || 'Internal routing contact',
        employeeNumber: routingEmployee.employeeNumber,
        designation: routingEmployee.designation,
        department: routingEmployee.department || request.fallbackDepartment,
        office: routingEmployee.office,
        phone: routingEmployee.phone,
        email: routingEmployee.email,
      }
    : null;

  if (request.requesterType === 'external' && request.externalRequesterId) {
    const [external] = await db
      .select({
        id: externalParties.id,
        firstName: externalParties.firstName,
        lastName: externalParties.lastName,
        organisationName: externalParties.organisationName,
        phone: externalParties.phone,
        email: externalParties.email,
      })
      .from(externalParties)
      .where(
        and(
          eq(externalParties.id, request.externalRequesterId),
          eq(externalParties.tenantId, request.tenantId),
        ),
      )
      .limit(1);
    if (!external) return null;

    return {
      requesterType: 'external',
      requester: {
        id: external.id,
        name: `${external.firstName} ${external.lastName}`.trim(),
        department: null,
        organisation: external.organisationName,
        phone: external.phone,
        email: external.email,
      },
      routingContact,
    };
  }

  if (!routingEmployee) return null;
  return {
    requesterType: 'internal',
    requester: {
      id: routingEmployee.id,
      name: routingEmployee.name || 'Unknown',
      employeeNumber: routingEmployee.employeeNumber,
      designation: routingEmployee.designation,
      department: routingEmployee.department || request.fallbackDepartment,
      office: routingEmployee.office,
      organisation: null,
      phone: routingEmployee.phone,
      email: routingEmployee.email,
    },
    routingContact: null,
  };
}
