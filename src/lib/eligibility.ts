/**
 * Eligibility checking utilities for drivers and vehicles
 */
import { getDb } from '@/db';
import { 
  and, asc, count, desc, eq, gt, inArray, lt, lte, gte, isNull, isNotNull, not, or, sql
} from 'drizzle-orm';
import { 
  employees, 
  driverProfiles, 
  driverLicences, 
  driverLicenceCodes, 
  driverProfessionalAuthorisations,
  vehicles,
  vehicleCategories,
  vehicleDocuments,
  vehicleDefects,
  vehicleAllocations,
  trips,
  transportRequests,
  requestDrivers,
  requestActivities,
  requestPassengers,
  requestRoutes,
} from '@/db/schema';

/**
 * Check if a driver is eligible for a vehicle and trip period
 * @param param0 
 * @returns 
 */
export async function checkDriverEligibility(params: {
  tenantId: string;
  driverId: string;
  vehicleId?: string;
  startDate: Date | string;
  endDate: Date | string;
}) {
  const { tenantId, driverId, vehicleId, startDate, endDate } = params;
  const dbInstance = getDb();
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Get driver with related data
  const [driverResult] = await dbInstance
    .select({
      employeeId: employees.id,
      employeeNumber: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employmentStatus: employees.employmentStatus,
      availabilityStatus: employees.availabilityStatus,
      isDriver: employees.isDriver,
      driverProfileId: driverProfiles.id,
      driverStatus: driverProfiles.driverStatus,
      driverAvailability: driverProfiles.availabilityStatus,
      lastVerifiedAt: driverProfiles.lastVerifiedAt,
      internalAuthorisationRef: driverProfiles.internalAuthorisationRef,
      suspensionReason: driverProfiles.suspensionReason,
      suspensionEndsAt: driverProfiles.suspensionEndsAt,
      licenceId: driverLicences.id,
      licenceNumber: driverLicences.licenceNumber,
      licenceClass: driverLicences.licenceClass,
      issueDate: driverLicences.issueDate,
      expiryDate: driverLicences.expiryDate,
      verificationStatus: driverLicences.verificationStatus,
      isActive: driverLicences.isActive,
      isVerified: driverLicences.isVerified,
      licenceClassRaw: driverLicences.licenceClass,
    })
    .from(employees)
    .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
    .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
    .where(and(
      eq(employees.id, driverId),
      eq(employees.tenantId, tenantId)
    ))
    .orderBy(desc(driverLicences.version))
    .limit(1);

  if (!driverResult) {
    return { eligible: false, reason: 'Driver not found' };
  }

  const {
    employeeId,
    employmentStatus,
    availabilityStatus,
    isDriver,
    driverStatus,
    driverAvailability,
    licenceId,
    licenceNumber,
    licenceClass,
    issueDate,
    expiryDate,
    verificationStatus,
    isActive,
    isVerified,
  } = driverResult;

  // Check employment status
  if (employmentStatus !== 'active') {
    return { eligible: false, reason: 'Employee is not active' };
  }

  // Check if employee is marked as driver
  if (!isDriver) {
    return { eligible: false, reason: 'Employee is not marked as a driver' };
  }

  // Check driver status
  if (driverStatus !== 'authorised') {
    return { eligible: false, reason: `Driver status is ${driverStatus}` };
  }

  // Check availability
  if (availabilityStatus !== 'available' && driverAvailability !== 'available') {
    return { eligible: false, reason: 'Driver is not available' };
  }

  // Check licence
  if (!licenceId) {
    return { eligible: false, reason: 'Driver has no licence' };
  }

  if (!isActive) {
    return { eligible: false, reason: 'Licence is not active' };
  }

  if (!isVerified) {
    return { eligible: false, reason: 'Licence is not verified' };
  }

  // Check licence validity period
  const licenceExpiry = new Date(expiryDate);
  if (licenceExpiry < start) {
    return { eligible: false, reason: 'Licence expires before trip start' };
  }
  if (licenceExpiry < end) {
    return { eligible: false, reason: 'Licence expires during trip' };
  }

  // Check licence issue date (must be before start)
  const licenceIssue = new Date(issueDate);
  if (licenceIssue > start) {
    return { eligible: false, reason: 'Licence issued after trip start' };
  }

  // TODO: Check licence class compatibility with vehicle (if vehicleId provided)
  // TODO: Check for overlapping assignments
  // TODO: Check professional authorisation requirements

  // If we made it here, the driver is eligible based on basic checks
  return { eligible: true };
}

/**
 * Check if a vehicle is eligible for a driver and trip period
 * @param param0 
 * @returns 
 */
export async function checkVehicleEligibility(params: {
  tenantId: string;
  vehicleId: string;
  driverId?: string;
  startDate: Date | string;
  endDate: Date | string;
}) {
  const { tenantId, vehicleId, driverId, startDate, endDate } = params;
  const dbInstance = getDb();
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Get vehicle with related data
  const [vehicleResult] = await dbInstance
    .select({
      id: vehicles.id,
      licenceNumber: vehicles.licenceNumber,
      make: vehicles.make,
      model: vehicles.model,
      manufactureYear: vehicles.manufactureYear,
      categoryId: vehicles.categoryId,
      status: vehicles.status,
      seatedCapacity: vehicles.seatedCapacity,
      standingCapacity: vehicles.standingCapacity,
      fuelType: vehicles.fuelType,
      transmission: vehicles.transmission,
      colour: vehicles.colour,
      vin: vehicles.vin,
      engineNumber: vehicles.engineNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      currentOdometer: vehicles.currentOdometer,
      fuelCardNumber: vehicles.fuelCardNumber,
      fuelCardPin: vehicles.fuelCardPin,
      assignedRegionId: vehicles.assignedRegionId,
      assignedOfficeId: vehicles.assignedOfficeId,
      requiredLicenceClass: vehicles.requiredLicenceClass,
      professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      specialRestriction: vehicles.specialRestriction,
      notes: vehicles.notes,
      version: vehicles.version,
      isActive: vehicles.isActive,
      createdAt: vehicles.createdAt,
      updatedAt: vehicles.updatedAt,
      categoryName: vehicleCategories.name,
      categoryCode: vehicleCategories.code,
      categoryPassengerCapacity: vehicleCategories.passengerCapacity,
      categoryCargoCapacity: vehicleCategories.cargoCapacity,
      categorySuitableTerrain: vehicleCategories.suitableTerrain,
      categoryFuelType: vehicleCategories.fuelType,
    })
    .from(vehicles)
    .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
    .where(and(
      eq(vehicles.id, vehicleId),
      eq(vehicles.tenantId, tenantId)
    ))
    .limit(1);

  if (!vehicleResult) {
    return { eligible: false, reason: 'Vehicle not found' };
  }

  const {
    id,
    licenceNumber,
    make,
    model,
    manufactureYear,
    categoryId,
    status,
    seatedCapacity,
    standingCapacity,
    fuelType,
    transmission,
    colour,
    vin,
    engineNumber,
    vehicleRegisterNumber,
    currentOdometer,
    fuelCardNumber,
    fuelCardPin,
    assignedRegionId,
    assignedOfficeId,
    requiredLicenceClass,
    professionalAuthorisationRequired,
    specialRestriction,
    notes,
    isActive,
    categoryName,
    categoryCode,
    categoryPassengerCapacity,
    categoryCargoCapacity,
    categorySuitableTerrain,
    categoryFuelType,
  } = vehicleResult;

  // Check if vehicle is active
  if (!isActive) {
    return { eligible: false, reason: 'Vehicle is not active' };
  }

  // Check vehicle status
  if (status !== 'available') {
    return { eligible: false, reason: `Vehicle is not available (status: ${status})` };
  }

  // Check for overlapping allocations
  const [overlap] = await dbInstance
    .select({ id: vehicleAllocations.id })
    .from(vehicleAllocations)
    .where(and(
      eq(vehicleAllocations.vehicleId, vehicleId),
      inArray(vehicleAllocations.state, ['confirmed', 'issued']),
      lt(vehicleAllocations.startAt, end),
      gt(vehicleAllocations.endAt, start)
    ))
    .limit(1);

  if (overlap) {
    return { eligible: false, reason: 'Vehicle is already allocated during this period' };
  }

  // TODO: Check for critical defects
  // TODO: Check document expiry (insurance, registration, roadworthiness)
  // TODO: Check licence expiry (vehicle's licenceExpiryDate)
  // TODO: Check seated capacity vs passenger count (need to get from request or driver's trip?)
  // TODO: Check terrain suitability
  // TODO: Check professional authorisation requirement vs driver's authorisation

  // If we made it here, the vehicle is eligible based on basic checks
  return { eligible: true };
}
