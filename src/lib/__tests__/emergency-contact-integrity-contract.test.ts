import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/emergency-contacts.ts'),
  'utf8',
);
const detailRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/emergency-contacts/[id]/route.ts'),
  'utf8',
);
const collectionRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/emergency-contacts/route.ts'),
  'utf8',
);

describe('emergency contact integrity contract', () => {
  it('short-circuits malformed contact ids before UUID-backed lookup', () => {
    const getter = service.indexOf('export async function getEmergencyContact');
    const guard = service.indexOf('if (!UUID_PATTERN.test(id)) return null;', getter);
    const db = service.indexOf('const db = getDb();', guard);
    const idPredicate = service.indexOf('eq(emergencyContacts.id, id)', db);

    expect(guard).toBeGreaterThan(getter);
    expect(db).toBeGreaterThan(guard);
    expect(idPredicate).toBeGreaterThan(db);
  });

  it('guards direct toggle and delete mutations before database access', () => {
    const toggle = service.indexOf('export async function setEmergencyContactActive');
    const toggleGuard = service.indexOf('if (!UUID_PATTERN.test(id)) return null;', toggle);
    const toggleDb = service.indexOf('const db = getDb();', toggleGuard);
    const remove = service.indexOf('export async function deleteEmergencyContact');
    const removeGuard = service.indexOf('if (!UUID_PATTERN.test(id)) return null;', remove);
    const removeDb = service.indexOf('const db = getDb();', removeGuard);

    expect(toggleGuard).toBeGreaterThan(toggle);
    expect(toggleDb).toBeGreaterThan(toggleGuard);
    expect(removeGuard).toBeGreaterThan(remove);
    expect(removeDb).toBeGreaterThan(removeGuard);
  });

  it('claims the reviewed emergency-contact revision before successful audit', () => {
    const update = service.indexOf('export async function updateEmergencyContact');
    const normalized = service.indexOf("date_trunc('milliseconds'", 0);
    const claim = service.indexOf('emergencyContactRevisionMatches(before.updatedAt)', update);
    const lost = service.indexOf('if (!row) throw new Error(EMERGENCY_CONTACT_EDIT_CONFLICT)', claim);
    const audit = service.indexOf("eventType: 'emergency_contact_updated'", lost);

    expect(normalized).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(update);
    expect(lost).toBeGreaterThan(claim);
    expect(audit).toBeGreaterThan(lost);
  });

  it('maps stale edit and duplicate identity conflicts to controlled 409 responses', () => {
    const stale = detailRoute.indexOf('error.message === EMERGENCY_CONTACT_EDIT_CONFLICT');
    const staleStatus = detailRoute.indexOf('{ status: 409 }', stale);
    const duplicate = detailRoute.indexOf("databaseCode(error) === '23505'", staleStatus);
    const duplicateStatus = detailRoute.indexOf('{ status: 409 }', duplicate);

    expect(stale).toBeGreaterThan(-1);
    expect(staleStatus).toBeGreaterThan(stale);
    expect(duplicate).toBeGreaterThan(staleStatus);
    expect(duplicateStatus).toBeGreaterThan(duplicate);
  });

  it('rejects malformed platform tenant overrides before collection service access', () => {
    const permission = collectionRoute.indexOf('Permissions.PLATFORM_ADMIN');
    const guard = collectionRoute.indexOf('invalidPlatformTenantOverride(tenantOverride, isPlatformAdmin)', permission);
    const invalid = collectionRoute.indexOf('tenantId must be a valid UUID', guard);
    const serviceCall = collectionRoute.indexOf('listEmergencyContacts(tenantId', invalid);

    expect(guard).toBeGreaterThan(permission);
    expect(invalid).toBeGreaterThan(guard);
    expect(serviceCall).toBeGreaterThan(invalid);
  });

  it('rejects malformed platform tenant overrides before detail mutations', () => {
    const permission = detailRoute.indexOf('Permissions.PLATFORM_ADMIN');
    const guard = detailRoute.indexOf('invalidPlatformTenantOverride(tenantOverride, isPlatformAdmin)', permission);
    const invalid = detailRoute.indexOf('tenantId must be a valid UUID', guard);
    const mutation = detailRoute.indexOf('setEmergencyContactActive(', invalid);

    expect(guard).toBeGreaterThan(permission);
    expect(invalid).toBeGreaterThan(guard);
    expect(mutation).toBeGreaterThan(invalid);
  });
});
