import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  employees,
  fuelTransactions,
  generatedDocuments,
  maintenanceEvents,
  requestDrivers,
  requestPassengers,
  transportRequests,
  trips,
  vehicleAllocations,
  vehicleDefects,
  vehicleInspections,
  vehicles,
} from '@/db/schema';
import type { DashboardRecordScope } from '@/lib/dashboard-access';

export type RecordScopeContext = {
  tenantId: string;
  userId: string;
  recordScope: DashboardRecordScope;
};

export function requestScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(transportRequests.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;
  return and(
    tenant,
    or(
      eq(transportRequests.requesterUserId, context.userId),
      eq(transportRequests.enteredByUserId, context.userId),
      sql`exists (
        select 1 from ${requestPassengers} rp
        inner join ${employees} e on e.id = rp.employee_id
        where rp.request_id = ${transportRequests.id}
          and e.tenant_id = ${context.tenantId}
          and e.user_id = ${context.userId}
          and rp.status <> 'removed'
      )`,
    )!,
  )!;
}

export function tripScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(trips.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;
  const assigned = sql`exists (
    select 1 from ${vehicleAllocations} va
    inner join ${employees} e on e.id = va.driver_employee_id
    where va.id = ${trips.allocationId}
      and e.tenant_id = ${context.tenantId}
      and e.user_id = ${context.userId}
  ) or exists (
    select 1 from ${requestDrivers} rd
    inner join ${employees} e on e.id = rd.employee_id
    where rd.request_id = ${trips.requestId}
      and e.tenant_id = ${context.tenantId}
      and e.user_id = ${context.userId}
      and rd.driver_type in ('assigned', 'additional')
  )`;
  if (context.recordScope === 'assigned') return and(tenant, assigned)!;
  return and(
    tenant,
    or(
      assigned,
      sql`exists (
        select 1 from ${transportRequests} tr
        where tr.id = ${trips.requestId}
          and tr.tenant_id = ${context.tenantId}
          and (tr.requester_user_id = ${context.userId} or tr.entered_by_user_id = ${context.userId})
      )`,
    )!,
  )!;
}

export function fuelScopeCondition(context: RecordScopeContext): SQL {
  const tenantVehicle = sql`exists (
    select 1 from ${vehicles} v
    where v.id = ${fuelTransactions.vehicleId} and v.tenant_id = ${context.tenantId}
  )`;
  if (context.recordScope === 'tenant') return tenantVehicle;
  return and(
    tenantVehicle,
    or(
      eq(fuelTransactions.recordedByUserId, context.userId),
      sql`exists (
        select 1 from ${trips} t
        inner join ${vehicleAllocations} va on va.id = t.allocation_id
        inner join ${employees} e on e.id = va.driver_employee_id
        where t.id = ${fuelTransactions.tripId}
          and t.tenant_id = ${context.tenantId}
          and e.user_id = ${context.userId}
      )`,
      sql`exists (
        select 1 from ${trips} t
        inner join ${requestDrivers} rd on rd.request_id = t.request_id
        inner join ${employees} e on e.id = rd.employee_id
        where t.id = ${fuelTransactions.tripId}
          and t.tenant_id = ${context.tenantId}
          and e.user_id = ${context.userId}
          and rd.driver_type in ('assigned', 'additional')
      )`,
    )!,
  )!;
}

export function inspectionScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(vehicleInspections.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;
  if (context.recordScope === 'assigned' || context.recordScope === 'self') {
    return and(tenant, eq(vehicleInspections.inspectorUserId, context.userId))!;
  }
  return and(
    tenant,
    or(
      eq(vehicleInspections.inspectorUserId, context.userId),
      sql`exists (
        select 1 from ${trips} t
        inner join ${transportRequests} tr on tr.id = t.request_id
        where t.id = ${vehicleInspections.tripId}
          and tr.requester_user_id = ${context.userId}
      )`,
    )!,
  )!;
}

export function vehicleScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(vehicles.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;
  return and(
    tenant,
    or(
      sql`exists (
        select 1 from ${trips} t
        inner join ${vehicleAllocations} va on va.id = t.allocation_id
        inner join ${employees} e on e.id = va.driver_employee_id
        where t.vehicle_id = ${vehicles.id} and e.user_id = ${context.userId}
      )`,
      sql`exists (
        select 1 from ${vehicleInspections} vi
        where vi.vehicle_id = ${vehicles.id} and vi.inspector_user_id = ${context.userId}
      )`,
      sql`exists (
        select 1 from ${maintenanceEvents} me
        where me.vehicle_id = ${vehicles.id}
          and (me.assigned_to_user_id = ${context.userId} or me.created_by_user_id = ${context.userId})
      )`,
      sql`exists (
        select 1 from ${vehicleDefects} vd
        where vd.vehicle_id = ${vehicles.id}
          and (vd.reported_by_user_id = ${context.userId} or vd.resolved_by_user_id = ${context.userId})
      )`,
    )!,
  )!;
}

export function documentScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(generatedDocuments.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;
  return and(
    tenant,
    or(
      eq(generatedDocuments.generatedByUserId, context.userId),
      sql`(
        ${generatedDocuments.entityType} = 'transport_request'
        and exists (
          select 1 from ${transportRequests} tr
          where tr.id = ${generatedDocuments.entityId}
            and (tr.requester_user_id = ${context.userId} or tr.entered_by_user_id = ${context.userId})
        )
      )`,
      sql`(
        ${generatedDocuments.entityType} in ('trip', 'trip_authority')
        and exists (
          select 1 from ${trips} t
          inner join ${vehicleAllocations} va on va.id = t.allocation_id
          inner join ${employees} e on e.id = va.driver_employee_id
          where t.id = ${generatedDocuments.entityId} and e.user_id = ${context.userId}
        )
      )`,
    )!,
  )!;
}

export function defectScopeCondition(context: RecordScopeContext): SQL {
  const tenantVehicle = sql`exists (
    select 1 from ${vehicles} v
    where v.id = ${vehicleDefects.vehicleId} and v.tenant_id = ${context.tenantId}
  )`;
  if (context.recordScope === 'tenant') return tenantVehicle;
  return and(
    tenantVehicle,
    or(
      eq(vehicleDefects.reportedByUserId, context.userId),
      eq(vehicleDefects.assignedToUserId, context.userId),
      eq(vehicleDefects.resolvedByUserId, context.userId),
    )!,
  )!;
}

export function maintenanceScopeCondition(context: RecordScopeContext): SQL {
  const tenantVehicle = sql`exists (
    select 1 from ${vehicles} v
    where v.id = ${maintenanceEvents.vehicleId} and v.tenant_id = ${context.tenantId}
  )`;
  if (context.recordScope === 'tenant') return tenantVehicle;
  return and(
    tenantVehicle,
    or(
      eq(maintenanceEvents.assignedToUserId, context.userId),
      eq(maintenanceEvents.createdByUserId, context.userId),
    )!,
  )!;
}
