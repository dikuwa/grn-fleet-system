import { getDb } from '@/db';
import {
  employees,
  roleDelegations,
  tenantMemberships,
  roleAssignments,
  roles,
} from '@/db/schema';
import { and, eq, gt, inArray, isNull, lte, notInArray, or } from 'drizzle-orm';
import { anyNamibiaLicenceClassCovers } from '@/lib/namibia-licence';

export const EMPLOYMENT_STATUSES = [
  'active',
  'on_leave',
  'acting_elsewhere',
  'temporarily_unavailable',
  'suspended',
  'transferred',
  'contract_ended',
  'retired',
  'deceased',
  'archived',
] as const;

export const AVAILABILITY_STATUSES = [
  'available',
  'annual_leave',
  'sick_leave',
  'official_travel',
  'training',
  'suspended',
  'off_duty',
  'temporarily_unavailable',
  'other',
] as const;

export interface DriverComplianceInput {
  employeeStatus: string;
  availabilityStatus: string;
  driverStatus: string;
  licenceStatus?: string | null;
  licenceExpiry?: string | null;
  licenceCodes: string[];
  requiredLicenceClass?: string | null;
  professionalRequired?: boolean;
  professionalVerified?: boolean;
  professionalExpiry?: string | null;
  tripEndAt: Date;
  hasScheduleConflict?: boolean;
  hasBlockingIncident?: boolean;
}

export interface DriverComplianceResult {
  status: 'eligible' | 'eligible_expiring_soon' | 'not_eligible' | 'missing_information' | 'awaiting_verification' | 'temporarily_unavailable';
  reasons: string[];
}

export function calculateDriverCompliance(input: DriverComplianceInput): DriverComplianceResult {
  const reasons: string[] = [];
  if (input.employeeStatus !== 'active') reasons.push('Employee is not active');
  if (input.availabilityStatus !== 'available') {
    return { status: 'temporarily_unavailable', reasons: [`Employee availability is ${input.availabilityStatus.replaceAll('_', ' ')}`] };
  }
  if (input.driverStatus !== 'authorised') reasons.push(`Driver status is ${input.driverStatus}`);
  if (!input.licenceExpiry || !input.licenceStatus) return { status: 'missing_information', reasons: ['No active licence record'] };
  if (input.licenceStatus !== 'verified') return { status: 'awaiting_verification', reasons: ['Licence is not verified'] };

  const expiry = new Date(`${input.licenceExpiry}T23:59:59.999Z`);
  if (expiry < input.tripEndAt) reasons.push('Licence expires before the trip ends');
  if (
    input.requiredLicenceClass &&
    !anyNamibiaLicenceClassCovers(input.licenceCodes, input.requiredLicenceClass)
  ) {
    reasons.push(`Required licence class ${input.requiredLicenceClass} is not covered by the driver's verified licence`);
  }
  if (input.professionalRequired && (!input.professionalVerified || !input.professionalExpiry)) {
    reasons.push('Verified professional authorisation is required');
  } else if (input.professionalRequired && new Date(`${input.professionalExpiry}T23:59:59.999Z`) < input.tripEndAt) {
    reasons.push('Professional authorisation expires before the trip ends');
  }
  if (input.hasScheduleConflict) reasons.push('Driver has an overlapping trip');
  if (input.hasBlockingIncident) reasons.push('Driver has an unresolved blocking incident');
  if (reasons.length) return { status: 'not_eligible', reasons };

  const days = Math.ceil((expiry.getTime() - input.tripEndAt.getTime()) / 86_400_000);
  return days <= 90
    ? { status: 'eligible_expiring_soon', reasons: [`Licence expires ${days} day${days === 1 ? '' : 's'} after the trip`] }
    : { status: 'eligible', reasons: [] };
}

export interface DelegationConflictInput {
  actingEmployeeId: string;
  roleId: string;
  substantiveHolderEmployeeId?: string | null;
  startAt: Date;
  endAt: Date;
  actingEmployeeStatus: string;
  actingAvailability: string;
  existing: Array<{ actingEmployeeId: string; roleId: string; startAt: Date; endAt: Date; status: string }>;
}

export function findDelegationConflicts(input: DelegationConflictInput): string[] {
  const conflicts: string[] = [];
  if (input.endAt <= input.startAt) conflicts.push('End date must be after the start date');
  if (input.actingEmployeeStatus !== 'active') conflicts.push('Acting employee is not active');
  if (input.actingAvailability !== 'available') conflicts.push('Acting employee is unavailable during this appointment');
  if (input.substantiveHolderEmployeeId === input.actingEmployeeId) conflicts.push('An employee cannot act for themselves');

  for (const existing of input.existing) {
    if (existing.status === 'revoked' || existing.status === 'cancelled') continue;
    const overlaps = input.startAt < existing.endAt && input.endAt > existing.startAt;
    if (!overlaps) continue;
    if (existing.roleId === input.roleId) conflicts.push('This role already has an overlapping acting appointment');
    if (existing.actingEmployeeId === input.actingEmployeeId) conflicts.push('The acting employee has an overlapping delegation');
  }
  return [...new Set(conflicts)];
}

export async function resolveRoleHolder(input: {
  tenantId: string;
  roleId: string;
  at?: Date;
  requireCapability?: 'approve' | 'sign' | 'allocate' | 'assign_driver' | 'reconcile';
  /**
   * Optional separation-of-duty exclusions. Role resolution skips these users
   * rather than pre-assigning a conflicted requester/traveller and deadlocking
   * every other eligible officer behind the explicit assignment guard.
   */
  excludeUserIds?: string[];
  excludeEmployeeIds?: string[];
}) {
  const db = getDb();
  const at = input.at || new Date();
  const excludedUserIds = [...new Set((input.excludeUserIds || []).filter(Boolean))];
  const excludedEmployeeIds = [...new Set((input.excludeEmployeeIds || []).filter(Boolean))];
  const capabilityColumn = {
    approve: roleDelegations.canApprove,
    sign: roleDelegations.canSign,
    allocate: roleDelegations.canAllocateVehicles,
    assign_driver: roleDelegations.canAssignDrivers,
    reconcile: roleDelegations.canReconcileTrips,
  }[input.requireCapability || 'approve'];

  const [acting] = await db.select({
    delegationId: roleDelegations.id,
    employeeId: employees.id,
    userId: employees.userId,
    firstName: employees.firstName,
    lastName: employees.lastName,
    capacity: roleDelegations.actingTitle,
  })
    .from(roleDelegations)
    .innerJoin(employees, eq(employees.id, roleDelegations.actingEmployeeId))
    .where(and(
      eq(roleDelegations.tenantId, input.tenantId),
      eq(roleDelegations.roleId, input.roleId),
      inArray(roleDelegations.status, ['scheduled', 'active']),
      lte(roleDelegations.startAt, at),
      gt(roleDelegations.endAt, at),
      eq(capabilityColumn, true),
      eq(employees.employmentStatus, 'active'),
      eq(employees.availabilityStatus, 'available'),
      excludedUserIds.length ? notInArray(employees.userId, excludedUserIds) : undefined,
      excludedEmployeeIds.length ? notInArray(employees.id, excludedEmployeeIds) : undefined,
    ))
    .limit(1);
  if (acting?.userId) return { ...acting, isActing: true };

  const [substantive] = await db.select({
    assignmentId: roleAssignments.id,
    employeeId: employees.id,
    userId: employees.userId,
    firstName: employees.firstName,
    lastName: employees.lastName,
    capacity: roles.name,
  })
    .from(roleAssignments)
    .innerJoin(tenantMemberships, eq(tenantMemberships.id, roleAssignments.tenantMembershipId))
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(employees, and(
      eq(employees.userId, tenantMemberships.userId),
      eq(employees.tenantId, input.tenantId),
    ))
    .where(and(
      eq(tenantMemberships.tenantId, input.tenantId),
      eq(roleAssignments.roleId, input.roleId),
      eq(roleAssignments.isActing, false),
      lte(roleAssignments.startDate, at),
      or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, at)),
      eq(employees.employmentStatus, 'active'),
      eq(employees.availabilityStatus, 'available'),
      excludedUserIds.length ? notInArray(employees.userId, excludedUserIds) : undefined,
      excludedEmployeeIds.length ? notInArray(employees.id, excludedEmployeeIds) : undefined,
    ))
    .limit(1);
  return substantive ? { ...substantive, isActing: false } : null;
}
