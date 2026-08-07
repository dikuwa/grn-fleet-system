/**
 * Tenant-configurable incident categories
 *
 * Categories allow each tenant to control the incident type taxonomy shown to
 * drivers and inspectors. Defaults are seeded at tenant onboarding/setup time;
 * transport admins can re-order, deactivate, and add categories.
 */

import { getDb } from '@/db';
import { incidentCategories } from '@/db/schema/trips';
import { eq, and, asc } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IncidentCategory = typeof incidentCategories.$inferSelect;

export type IncidentCategoryInput = {
  code: string;
  name: string;
  group: 'vehicle' | 'route_safety' | 'security' | 'other';
  sortOrder?: number;
  requiresMvaForm?: boolean;
  isActive?: boolean;
};

export type IncidentCategoryGroup = IncidentCategory['group'];

// ---------------------------------------------------------------------------
// Default categories (seeded when a tenant is created)
// ---------------------------------------------------------------------------

export const DEFAULT_INCIDENT_CATEGORIES: IncidentCategoryInput[] = [
  // Vehicle and mechanical
  { code: 'mechanical_defect', name: 'Mechanical defect', group: 'vehicle', sortOrder: 10 },
  { code: 'electrical_defect', name: 'Electrical defect', group: 'vehicle', sortOrder: 20 },
  { code: 'tyre_failure', name: 'Tyre failure', group: 'vehicle', sortOrder: 30 },
  { code: 'breakdown', name: 'Breakdown', group: 'vehicle', sortOrder: 40 },
  { code: 'physical_vehicle_damage', name: 'Physical vehicle damage', group: 'vehicle', sortOrder: 50 },
  { code: 'warning_light', name: 'Warning light', group: 'vehicle', sortOrder: 60 },
  { code: 'fuel_leak_issue', name: 'Fuel leak or fuel issue', group: 'vehicle', sortOrder: 70 },
  { code: 'fire_smoke', name: 'Fire or smoke', group: 'vehicle', sortOrder: 80 },

  // Accident and people
  { code: 'accident_collision', name: 'Accident or collision', group: 'route_safety', sortOrder: 90, requiresMvaForm: true },
  { code: 'near_miss', name: 'Near miss', group: 'route_safety', sortOrder: 100 },
  { code: 'passenger_injury', name: 'Passenger injury', group: 'route_safety', sortOrder: 110, requiresMvaForm: true },
  { code: 'driver_injury', name: 'Driver injury', group: 'route_safety', sortOrder: 120, requiresMvaForm: true },
  { code: 'third_party_injury', name: 'Third-party injury', group: 'route_safety', sortOrder: 130, requiresMvaForm: true },
  { code: 'third_party_vehicle_damage', name: 'Third-party vehicle damage', group: 'route_safety', sortOrder: 140, requiresMvaForm: true },
  { code: 'property_damage', name: 'Property damage', group: 'route_safety', sortOrder: 150 },

  // Route and safety
  { code: 'unsafe_road_condition', name: 'Unsafe road condition', group: 'route_safety', sortOrder: 160 },
  { code: 'route_obstruction', name: 'Route obstruction', group: 'route_safety', sortOrder: 170 },
  { code: 'weather_hazard', name: 'Weather hazard', group: 'route_safety', sortOrder: 180 },
  { code: 'security_incident', name: 'Security incident', group: 'security', sortOrder: 190 },
  { code: 'theft_attempted_theft', name: 'Theft or attempted theft', group: 'security', sortOrder: 200 },
  { code: 'traffic_offence', name: 'Traffic offence', group: 'route_safety', sortOrder: 210 },
  { code: 'police_intervention', name: 'Police intervention', group: 'route_safety', sortOrder: 220 },
  { code: 'other_safety_incident', name: 'Other safety incident', group: 'other', sortOrder: 230 },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export type IncidentCategoryGroupCode = 'vehicle' | 'route_safety' | 'security' | 'other';

export function categorizeGroup(group: string): IncidentCategoryGroupCode {
  if (['vehicle', 'route_safety', 'security', 'other'].includes(group)) {
    return group as IncidentCategoryGroupCode;
  }
  return 'other';
}

export function groupLabel(group: IncidentCategoryGroupCode): string {
  switch (group) {
    case 'vehicle':
      return 'Vehicle and mechanical';
    case 'route_safety':
      return 'Route and safety';
    case 'security':
      return 'Security';
    case 'other':
      return 'Other';
    default:
      return group;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listIncidentCategories(tenantId: string, opts?: { includeInactive?: boolean }) {
  const db = getDb();
  const conditions = [eq(incidentCategories.tenantId, tenantId)];
  if (!opts?.includeInactive) conditions.push(eq(incidentCategories.isActive, true));
  return db
    .select()
    .from(incidentCategories)
    .where(and(...conditions))
    .orderBy(asc(incidentCategories.sortOrder), asc(incidentCategories.name));
}

export async function getIncidentCategory(tenantId: string, code: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(incidentCategories)
    .where(and(eq(incidentCategories.tenantId, tenantId), eq(incidentCategories.code, code)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function upsertIncidentCategory(
  tenantId: string,
  input: IncidentCategoryInput,
  actorUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .insert(incidentCategories)
    .values({
      tenantId,
      code: input.code,
      name: input.name,
      group: input.group,
      sortOrder: input.sortOrder ?? 0,
      requiresMvaForm: input.requiresMvaForm ?? false,
      isActive: input.isActive ?? true,
    })
    .onConflictDoUpdate({
      target: [incidentCategories.tenantId, incidentCategories.code],
      set: {
        name: input.name,
        group: input.group,
        sortOrder: input.sortOrder ?? 0,
        requiresMvaForm: input.requiresMvaForm ?? false,
        isActive: input.isActive ?? true,
        updatedAt: new Date(),
      },
    })
    .returning();

  await recordAuditEvent({
    tenantId,
    actorUserId,
    eventType: 'incident_category_upsert',
    action: 'upsert',
    entityType: 'incident_category',
    entityId: row.id,
    summary: `Incident category ${input.code} (${input.group}) upserted`,
    after: input,
    sourceChannel: 'web',
  });

  return row;
}

/** Seed the default taxonomy for a brand-new tenant (called from onboarding). */
export async function seedDefaultIncidentCategories(tenantId: string, actorUserId: string) {
  const db = getDb();
  const existing = await listIncidentCategories(tenantId, { includeInactive: true });
  if (existing.length > 0) return existing;
  const seeded: IncidentCategory[] = [];
  for (const category of DEFAULT_INCIDENT_CATEGORIES) {
    const [row] = await db
      .insert(incidentCategories)
      .values({
        tenantId,
        code: category.code,
        name: category.name,
        group: category.group,
        sortOrder: category.sortOrder ?? 0,
        requiresMvaForm: category.requiresMvaForm ?? false,
        isActive: true,
      })
      .onConflictDoNothing({ target: [incidentCategories.tenantId, incidentCategories.code] })
      .returning();
    if (row) seeded.push(row);
  }
  if (seeded.length > 0) {
    await recordAuditEvent({
      tenantId,
      actorUserId,
      eventType: 'incident_categories_seeded',
      action: 'seed',
      entityType: 'incident_category',
      summary: `Seeded ${seeded.length} default incident categories`,
      sourceChannel: 'system',
    });
  }
  return seeded;
}

export async function setIncidentCategoryActive(
  tenantId: string,
  code: string,
  isActive: boolean,
  actorUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .update(incidentCategories)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(incidentCategories.tenantId, tenantId), eq(incidentCategories.code, code)))
    .returning();
  if (!row) return null;

  await recordAuditEvent({
    tenantId,
    actorUserId,
    eventType: 'incident_category_toggle',
    action: isActive ? 'activate' : 'deactivate',
    entityType: 'incident_category',
    entityId: row.id,
    summary: `Incident category ${code} ${isActive ? 'activated' : 'deactivated'}`,
    sourceChannel: 'web',
  });

  return row;
}
