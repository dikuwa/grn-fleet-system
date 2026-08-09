import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';

export type RequestDriverEligibilityFailure = {
  employeeId: string;
  reasons: string[];
};

/**
 * Validate requester-nominated drivers using the same licence lifecycle rules
 * as Transport Review, limited to facts known before a vehicle is assigned.
 *
 * Vehicle-class compatibility and professional authorisation remain final
 * Transport Administration checks because the Requester does not choose the
 * actual fleet vehicle. Employment/availability, authorised driver status,
 * active verified licence state and validity through the requested trip end
 * are enforced here.
 */
export async function validateRequesterDriverNominations(input: {
  tenantId: string;
  employeeIds: string[];
  tripEndAt: Date;
}): Promise<{ ok: true } | { ok: false; failures: RequestDriverEligibilityFailure[] }> {
  const uniqueIds = Array.from(new Set(input.employeeIds.filter(Boolean)));
  if (uniqueIds.length === 0) return { ok: true };

  const db = getDb();
  const people = await db
    .select({
      employeeId: employees.id,
      employmentStatus: employees.employmentStatus,
      employeeAvailability: employees.availabilityStatus,
      isDriver: employees.isDriver,
      profileId: driverProfiles.id,
      driverStatus: driverProfiles.driverStatus,
      profileAvailability: driverProfiles.availabilityStatus,
    })
    .from(employees)
    .leftJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
    .where(and(eq(employees.tenantId, input.tenantId), inArray(employees.id, uniqueIds)));

  const profileIds = people
    .map((person) => person.profileId)
    .filter((profileId): profileId is string => Boolean(profileId));
  const licences =
    profileIds.length > 0
      ? await db
          .select({
            id: driverLicences.id,
            driverProfileId: driverLicences.driverProfileId,
            version: driverLicences.version,
            expiryDate: driverLicences.expiryDate,
            verificationStatus: driverLicences.verificationStatus,
            isActive: driverLicences.isActive,
          })
          .from(driverLicences)
          .where(
            and(
              inArray(driverLicences.driverProfileId, profileIds),
              eq(driverLicences.isActive, true),
            ),
          )
      : [];

  // Match Transport Review: only the highest-version active licence for a
  // profile is authoritative. A newer provisional renewal cannot be bypassed
  // by silently falling back to an older active version.
  const licenceByProfile = new Map<string, (typeof licences)[number]>();
  for (const licence of licences) {
    const current = licenceByProfile.get(licence.driverProfileId);
    if (!current || licence.version > current.version) {
      licenceByProfile.set(licence.driverProfileId, licence);
    }
  }

  const peopleById = new Map(people.map((person) => [person.employeeId, person]));
  const failures: RequestDriverEligibilityFailure[] = [];

  for (const employeeId of uniqueIds) {
    const person = peopleById.get(employeeId);
    if (!person) {
      failures.push({ employeeId, reasons: ['Driver is not an active member of this organisation'] });
      continue;
    }
    if (!person.isDriver || !person.profileId) {
      failures.push({ employeeId, reasons: ['Employee is not configured as a driver'] });
      continue;
    }

    const licence = licenceByProfile.get(person.profileId);
    const availability =
      person.employeeAvailability !== 'available'
        ? person.employeeAvailability
        : person.profileAvailability || 'available';
    const compliance = calculateDriverCompliance({
      employeeStatus: person.employmentStatus,
      availabilityStatus: availability,
      driverStatus: person.driverStatus || 'unauthorised',
      licenceStatus: licence?.verificationStatus ?? null,
      licenceExpiry: licence?.expiryDate ?? null,
      licenceCodes: [],
      tripEndAt: input.tripEndAt,
    });

    if (compliance.status !== 'eligible' && compliance.status !== 'eligible_expiring_soon') {
      failures.push({
        employeeId,
        reasons: compliance.reasons.length ? compliance.reasons : ['Driver is not eligible for this trip'],
      });
    }
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true };
}
