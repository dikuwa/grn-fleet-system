import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  employees,
  externalDriverAssignments,
  fuelTransactions,
  generatedDocuments,
  maintenanceEvents,
  requestDrivers,
  requestPassengers,
  transportRequests,
  tripAuthorities,
  tripIncidents,
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

  const owned = or(
    eq(transportRequests.requesterUserId, context.userId),
    eq(transportRequests.enteredByUserId, context.userId),
  )!;

  // "My Requests" / self scope means requests the signed-in user created or
  // that were entered on their behalf. Passenger participation is a related
  // relationship, not ownership; including it in self scope exposed another
  // requester's draft in My Requests/My Drafts before submission.
  if (context.recordScope === 'self') return and(tenant, owned)!;

  const participant = sql`exists (
    select 1 from ${requestPassengers} rp
    inner join ${employees} e on e.id = rp.employee_id
    where rp.request_id = ${transportRequests.id}
      and e.tenant_id = ${context.tenantId}
      and e.user_id = ${context.userId}
      and rp.status <> 'removed'
  )`;

  return and(tenant, or(owned, participant)!)!;
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
          and e.tenant_id = ${context.tenantId}
          and e.user_id = ${context.userId}
      )`,
      sql`exists (
        select 1 from ${trips} t
        inner join ${requestDrivers} rd on rd.request_id = t.request_id
        inner join ${employees} e on e.id = rd.employee_id
        where t.id = ${fuelTransactions.tripId}
          and t.tenant_id = ${context.tenantId}
          and e.tenant_id = ${context.tenantId}
          and e.user_id = ${context.userId}
          and rd.driver_type in ('assigned', 'additional')
      )`,
    )!,
  )!;
}

export function inspectionScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(vehicleInspections.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;

  const assignedTrip = sql`exists (
    select 1 from ${trips} t
    left join ${vehicleAllocations} va on va.id = t.allocation_id
    left join ${employees} primary_driver
      on primary_driver.id = va.driver_employee_id
     and primary_driver.tenant_id = ${context.tenantId}
    where t.id = ${vehicleInspections.tripId}
      and t.tenant_id = ${context.tenantId}
      and (
        primary_driver.user_id = ${context.userId}
        or exists (
          select 1 from ${requestDrivers} rd
          inner join ${employees} additional_driver on additional_driver.id = rd.employee_id
          where rd.request_id = t.request_id
            and additional_driver.tenant_id = ${context.tenantId}
            and additional_driver.user_id = ${context.userId}
            and rd.driver_type in ('assigned', 'additional')
        )
      )
  )`;

  if (context.recordScope === 'assigned' || context.recordScope === 'self') {
    return and(
      tenant,
      or(eq(vehicleInspections.inspectorUserId, context.userId), assignedTrip)!,
    )!;
  }
  return and(
    tenant,
    or(
      eq(vehicleInspections.inspectorUserId, context.userId),
      assignedTrip,
      sql`exists (
        select 1 from ${trips} t
        inner join ${transportRequests} tr on tr.id = t.request_id
        where t.id = ${vehicleInspections.tripId}
          and t.tenant_id = ${context.tenantId}
          and tr.tenant_id = ${context.tenantId}
          and (tr.requester_user_id = ${context.userId} or tr.entered_by_user_id = ${context.userId})
      )`,
    )!,
  )!;
}

export function vehicleScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(vehicles.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;

  const userRelationship = or(
    sql`exists (
      select 1 from ${trips} t
      inner join ${vehicleAllocations} va on va.id = t.allocation_id
      inner join ${employees} e on e.id = va.driver_employee_id
      where t.vehicle_id = ${vehicles.id}
        and t.tenant_id = ${context.tenantId}
        and e.tenant_id = ${context.tenantId}
        and e.user_id = ${context.userId}
    )`,
    sql`exists (
      select 1 from ${vehicleInspections} vi
      where vi.vehicle_id = ${vehicles.id}
        and vi.tenant_id = ${context.tenantId}
        and vi.inspector_user_id = ${context.userId}
    )`,
    sql`exists (
      select 1 from ${maintenanceEvents} me
      where me.vehicle_id = ${vehicles.id}
        and (me.assigned_to_user_id = ${context.userId} or me.created_by_user_id = ${context.userId})
    )`,
    sql`exists (
      select 1 from ${vehicleDefects} vd
      where vd.vehicle_id = ${vehicles.id}
        and (
          vd.reported_by_user_id = ${context.userId}
          or vd.assigned_to_user_id = ${context.userId}
          or vd.resolved_by_user_id = ${context.userId}
        )
    )`,
  )!;

  if (context.recordScope === 'assigned') {
    // Inspector vehicle lookup is a supporting view for the official inspection
    // queue. There is no separate inspector-assignment entity: any Inspector may
    // perform a lifecycle-eligible official inspection. Include vehicles with an
    // eligible departure/return trip before the first inspection is recorded, while
    // preserving historical user relationships after the work is completed.
    const inspectionWorkPending = sql`exists (
      select 1
      from ${trips} pending_trip
      inner join ${transportRequests} pending_request
        on pending_request.id = pending_trip.request_id
       and pending_request.tenant_id = ${context.tenantId}
      inner join ${vehicleAllocations} pending_allocation
        on pending_allocation.id = pending_trip.allocation_id
       and pending_allocation.request_id = pending_trip.request_id
       and pending_allocation.vehicle_id = pending_trip.vehicle_id
       and pending_allocation.state = 'confirmed'
      inner join ${tripAuthorities} pending_authority
        on pending_authority.trip_id = pending_trip.id
       and pending_authority.request_id = pending_trip.request_id
       and pending_authority.allocation_id = pending_trip.allocation_id
       and pending_authority.tenant_id = ${context.tenantId}
      where pending_trip.vehicle_id = ${vehicles.id}
        and pending_trip.tenant_id = ${context.tenantId}
        and (
          (
            pending_trip.status = 'pending'
            and pending_request.status in ('authorised', 'ready_for_issue', 'approved', 'approved_emergency')
            and pending_authority.status in ('driver_accepted', 'awaiting_pre_trip_inspection')
            and (
              pending_allocation.driver_employee_id is not null
              or exists (
                select 1 from ${externalDriverAssignments} departure_external
                where departure_external.trip_id = pending_trip.id
                  and departure_external.allocation_id = pending_trip.allocation_id
                  and departure_external.tenant_id = ${context.tenantId}
                  and departure_external.state = 'accepted'
              )
            )
          )
          or (
            pending_trip.status in ('in_progress', 'return_due', 'return_inspection')
            and pending_authority.status in ('returned', 'awaiting_arrival_inspection')
            and (
              pending_allocation.driver_employee_id is not null
              or exists (
                select 1 from ${externalDriverAssignments} return_external
                where return_external.trip_id = pending_trip.id
                  and return_external.allocation_id = pending_trip.allocation_id
                  and return_external.tenant_id = ${context.tenantId}
                  and return_external.state = 'accepted'
                  and return_external.issue_id is not null
              )
            )
          )
        )
    )`;

    return and(tenant, or(userRelationship, inspectionWorkPending)!)!;
  }

  if (context.recordScope === 'related') {
    // Maintenance owns the related Fleet workspace. Its Defects queue deliberately
    // includes unassigned defects so newly-created safety work cannot disappear
    // when no officer was assigned at inspection time. The corresponding vehicle
    // must therefore be selectable/openable for maintenance triage. Keep this
    // exception out of assigned scope so Inspector/Driver views do not gain
    // unrelated vehicles merely because another user's defect is unassigned.
    return and(
      tenant,
      or(
        userRelationship,
        sql`exists (
          select 1 from ${vehicleDefects} unassigned_defect
          where unassigned_defect.vehicle_id = ${vehicles.id}
            and unassigned_defect.assigned_to_user_id is null
            and unassigned_defect.resolved_at is null
        )`,
      )!,
    )!;
  }

  return and(tenant, userRelationship)!;
}

export function documentScopeCondition(context: RecordScopeContext): SQL {
  const tenant = eq(generatedDocuments.tenantId, context.tenantId);
  if (context.recordScope === 'tenant') return tenant;

  // Resolve every user-facing generated-document family back to one tenant
  // transport request. This keeps the document list consistent with direct
  // detail/PDF authorization instead of relying on who happened to generate
  // the snapshot or on a document-type-specific entity-id assumption.
  const linkedRequestId = sql`case
    when ${generatedDocuments.entityType} = 'transport_request' then ${generatedDocuments.entityId}
    when ${generatedDocuments.entityType} = 'trip' then (
      select t.request_id from ${trips} t
      where t.id = ${generatedDocuments.entityId}
        and t.tenant_id = ${context.tenantId}
      limit 1
    )
    when ${generatedDocuments.entityType} = 'vehicle_allocation' then (
      select va.request_id from ${vehicleAllocations} va
      inner join ${transportRequests} tr on tr.id = va.request_id
      where va.id = ${generatedDocuments.entityId}
        and tr.tenant_id = ${context.tenantId}
      limit 1
    )
    when ${generatedDocuments.entityType} = 'inspection' then (
      select t.request_id from ${vehicleInspections} vi
      inner join ${trips} t on t.id = vi.trip_id
      where vi.id = ${generatedDocuments.entityId}
        and vi.tenant_id = ${context.tenantId}
        and t.tenant_id = ${context.tenantId}
      limit 1
    )
    when ${generatedDocuments.entityType} = 'trip_incident' then (
      select t.request_id from ${tripIncidents} ti
      inner join ${trips} t on t.id = ti.trip_id
      where ti.id = ${generatedDocuments.entityId}
        and ti.tenant_id = ${context.tenantId}
        and t.tenant_id = ${context.tenantId}
      limit 1
    )
    when ${generatedDocuments.entityType} = 'trip_authority' then (
      select ta.request_id from ${tripAuthorities} ta
      where ta.id = ${generatedDocuments.entityId}
        and ta.tenant_id = ${context.tenantId}
      limit 1
    )
    else null
  end`;

  const personalRelationship = sql`exists (
    select 1 from ${transportRequests} tr
    where tr.id = ${linkedRequestId}
      and tr.tenant_id = ${context.tenantId}
      and (
        tr.requester_user_id = ${context.userId}
        or tr.entered_by_user_id = ${context.userId}
        or exists (
          select 1 from ${requestPassengers} rp
          inner join ${employees} passenger on passenger.id = rp.employee_id
          where rp.request_id = tr.id
            and rp.status <> 'removed'
            and passenger.tenant_id = ${context.tenantId}
            and passenger.user_id = ${context.userId}
        )
      )
  )`;

  const driverRelationship = sql`exists (
    select 1 from ${transportRequests} tr
    where tr.id = ${linkedRequestId}
      and tr.tenant_id = ${context.tenantId}
      and (
        exists (
          select 1 from ${employees} assigned_driver
          where assigned_driver.id = tr.assigned_driver_employee_id
            and assigned_driver.tenant_id = ${context.tenantId}
            and assigned_driver.user_id = ${context.userId}
        )
        or exists (
          select 1 from ${requestDrivers} rd
          inner join ${employees} driver on driver.id = rd.employee_id
          where rd.request_id = tr.id
            and rd.driver_type in ('assigned', 'additional')
            and driver.tenant_id = ${context.tenantId}
            and driver.user_id = ${context.userId}
        )
      )
  )`;

  if (context.recordScope === 'self') return and(tenant, personalRelationship)!;
  if (context.recordScope === 'assigned') return and(tenant, driverRelationship)!;
  return and(tenant, or(personalRelationship, driverRelationship)!)!;
}

export function defectScopeCondition(context: RecordScopeContext): SQL {
  const tenantVehicle = sql`exists (
    select 1 from ${vehicles} v
    where v.id = ${vehicleDefects.vehicleId} and v.tenant_id = ${context.tenantId}
  )`;
  if (context.recordScope === 'tenant') return tenantVehicle;

  // An assigned Maintenance queue must also surface unassigned defects. This
  // prevents safety work created while no Maintenance Officer was active from
  // becoming permanently invisible after an officer is later assigned.
  if (context.recordScope === 'assigned') {
    return and(
      tenantVehicle,
      or(
        eq(vehicleDefects.assignedToUserId, context.userId),
        isNull(vehicleDefects.assignedToUserId),
        eq(vehicleDefects.resolvedByUserId, context.userId),
      )!,
    )!;
  }

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

  const userRelationship = or(
    eq(maintenanceEvents.assignedToUserId, context.userId),
    eq(maintenanceEvents.createdByUserId, context.userId),
  )!;

  // Critical inspection follow-ups may be created while no Maintenance Officer
  // is active, leaving assigned_to_user_id null. The assigned Maintenance queue
  // must surface those orphaned rows so they can be triaged later, mirroring the
  // unassigned-defect behavior above. Other scopes keep strict user relationships.
  if (context.recordScope === 'assigned') {
    return and(
      tenantVehicle,
      or(userRelationship, isNull(maintenanceEvents.assignedToUserId))!,
    )!;
  }

  return and(tenantVehicle, userRelationship)!;
}
