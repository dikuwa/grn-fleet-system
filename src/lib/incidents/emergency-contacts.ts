/**
 * Tenant emergency contacts
 *
 * Contacts are cached per tenant and region so drivers and inspectors can
 * reach the right services (hospital, police, towing, fire, insurance,
 * internal) while reporting an incident. Region-specific contacts override
 * general ones; a NULL region matches every region.
 */

import { getDb } from '@/db';
import { emergencyContacts } from '@/db/schema/trips';
import { eq, and, asc, or, isNull } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';

// Re-export client-safe constants and types
export {
  EMERGENCY_CONTACT_ROLES,
  isEmergencyContactRole,
  emergencyContactRoleLabel,
} from './emergency-contact-constants';
import type { EmergencyContactRole } from './emergency-contact-constants';
export type { EmergencyContactRole } from './emergency-contact-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmergencyContact = typeof emergencyContacts.$inferSelect;

export type EmergencyContactInput = {
  name: string;
  phone: string;
  role: EmergencyContactRole;
  region?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listEmergencyContacts(
  tenantId: string,
  opts?: {
    includeInactive?: boolean;
    region?: string | null;
    role?: string | null;
  },
) {
  const db = getDb();
  const conditions = [eq(emergencyContacts.tenantId, tenantId)];
  if (!opts?.includeInactive) conditions.push(eq(emergencyContacts.isActive, true));
  if (opts?.region) {
    // Region-specific contacts for this region, plus general (NULL region) ones.
    conditions.push(
      or(
        eq(emergencyContacts.region, opts.region),
        isNull(emergencyContacts.region),
      )!,
    );
  }
  if (opts?.role) conditions.push(eq(emergencyContacts.role, opts.role));

  return db
    .select()
    .from(emergencyContacts)
    .where(and(...conditions))
    .orderBy(asc(emergencyContacts.sortOrder), asc(emergencyContacts.name));
}

export async function getEmergencyContact(tenantId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emergencyContacts)
    .where(and(eq(emergencyContacts.tenantId, tenantId), eq(emergencyContacts.id, id)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function upsertEmergencyContact(
  tenantId: string,
  input: EmergencyContactInput,
  actorUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .insert(emergencyContacts)
    .values({
      tenantId,
      name: input.name,
      phone: input.phone,
      role: input.role,
      region: input.region ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    })
    .onConflictDoUpdate({
      target: [emergencyContacts.tenantId, emergencyContacts.phone, emergencyContacts.role],
      set: {
        name: input.name,
        region: input.region ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
        updatedAt: new Date(),
      },
    })
    .returning();

  await recordAuditEvent({
    tenantId,
    actorUserId,
    eventType: 'emergency_contact_upsert',
    action: 'upsert',
    entityType: 'emergency_contact',
    entityId: row.id,
    summary: `Emergency contact ${input.name} (${input.role}) upserted`,
    after: input,
    sourceChannel: 'web',
  });

  return row;
}

export async function setEmergencyContactActive(
  tenantId: string,
  id: string,
  isActive: boolean,
  actorUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .update(emergencyContacts)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(emergencyContacts.tenantId, tenantId), eq(emergencyContacts.id, id)))
    .returning();
  if (!row) return null;

  await recordAuditEvent({
    tenantId,
    actorUserId,
    eventType: 'emergency_contact_toggle',
    action: isActive ? 'activate' : 'deactivate',
    entityType: 'emergency_contact',
    entityId: row.id,
    summary: `Emergency contact ${row.name} ${isActive ? 'activated' : 'deactivated'}`,
    sourceChannel: 'web',
  });

  return row;
}

export async function deleteEmergencyContact(
  tenantId: string,
  id: string,
  actorUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .delete(emergencyContacts)
    .where(and(eq(emergencyContacts.tenantId, tenantId), eq(emergencyContacts.id, id)))
    .returning();
  if (!row) return null;

  await recordAuditEvent({
    tenantId,
    actorUserId,
    eventType: 'emergency_contact_deleted',
    action: 'delete',
    entityType: 'emergency_contact',
    entityId: row.id,
    summary: `Emergency contact ${row.name} deleted`,
    before: { name: row.name, phone: row.phone, role: row.role, region: row.region },
    sourceChannel: 'web',
  });

  return row;
}
