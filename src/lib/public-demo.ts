import { randomUUID } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { demoSandboxes } from '@/db/schema/demo-requests';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { roleAssignments, rolePermissions, roles, tenantMemberships, tenants } from '@/db/schema/tenants';
import { Permissions, RoleDefinitions, type PermissionCode } from '@/lib/permissions';
import { WorkspaceIds, type WorkspaceId } from '@/lib/workspaces';

export const LIVE_DEMO_PERSONAS = {
  transport: {
    label: 'Transport Officer',
    description: 'Review requests, manage fleet operations and allocate vehicles.',
    role: RoleDefinitions.TRANSPORT_ADMIN,
    workspace: WorkspaceIds.TRANSPORT_ADMIN,
  },
  requester: {
    label: 'Requester',
    description: 'Create and follow a transport request through the real workflow.',
    role: RoleDefinitions.REQUESTER,
    workspace: WorkspaceIds.PERSONAL,
  },
  approver: {
    label: 'Approver',
    description: 'Review requests and experience role-based approval decisions.',
    role: RoleDefinitions.SUPERVISOR,
    workspace: WorkspaceIds.APPROVER,
  },
  driver: {
    label: 'Driver',
    description: 'Explore assigned-trip, logbook, fuel and incident workflows.',
    role: RoleDefinitions.DRIVER,
    workspace: WorkspaceIds.DRIVER,
  },
} as const;

export type LiveDemoPersonaKey = keyof typeof LIVE_DEMO_PERSONAS;

type DemoMetadata = Record<string, unknown> & {
  publicLiveDemo?: boolean;
  publicDemoPublishedAt?: string;
  publicDemoPersonas?: Partial<Record<LiveDemoPersonaKey, string>>;
};

const DEMO_PERMISSION_DENYLIST = new Set<PermissionCode>([
  Permissions.FILE_UPLOAD,
  Permissions.USER_INVITE,
  Permissions.USER_MANAGE_STATUS,
  Permissions.TENANT_MANAGE,
  Permissions.STAFF_IMPORT,
  Permissions.STAFF_LIFECYCLE_MANAGE,
  Permissions.DRIVER_ARCHIVE,
  Permissions.DRIVER_REVOKE,
]);

function safePermissions(permissions: readonly PermissionCode[]) {
  return permissions.filter((permission) => !DEMO_PERMISSION_DENYLIST.has(permission));
}

function demoEmail(persona: LiveDemoPersonaKey, sandboxId: string) {
  return `live-demo-${persona}-${sandboxId.slice(0, 8)}@govfleet.local`;
}

async function ensureRole(
  tenantId: string,
  persona: LiveDemoPersonaKey,
): Promise<string> {
  const db = getDb();
  const definition = LIVE_DEMO_PERSONAS[persona].role;
  const marker = `Public live demo: ${persona}`;
  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.description, marker)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(roles)
    .values({ tenantId, name: definition.name, description: marker, isSystem: true })
    .returning({ id: roles.id });
  const permissions = safePermissions(definition.permissions as readonly PermissionCode[]);
  if (permissions.length) {
    await db.insert(rolePermissions).values(
      permissions.map((permissionCode) => ({ roleId: created.id, permissionCode })),
    );
  }
  return created.id;
}

async function ensurePersona(
  sandboxId: string,
  tenantId: string,
  persona: LiveDemoPersonaKey,
): Promise<string> {
  const db = getDb();
  const email = demoEmail(persona, sandboxId);
  const definition = LIVE_DEMO_PERSONAS[persona];
  const [existingUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existingUser) return existingUser.id;

  const userId = `live-demo-${persona}-${randomUUID()}`;
  const displayName = `Demo ${definition.label}`;
  const now = new Date();
  await db.insert(user).values({
    id: userId,
    email,
    username: `demo.${persona}.${sandboxId.slice(0, 6)}`,
    emailVerified: true,
    name: displayName,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(userProfiles).values({
    id: userId,
    userId,
    displayName,
    requiresPasswordChange: false,
    passwordStatus: 'managed',
    status: 'active',
    accountEnabled: true,
  });

  const [membership] = await db
    .insert(tenantMemberships)
    .values({
      tenantId,
      userId,
      status: 'active',
      activeWorkspace: definition.workspace,
      joinedAt: now,
    })
    .returning({ id: tenantMemberships.id });
  const roleId = await ensureRole(tenantId, persona);
  await db.insert(roleAssignments).values({ tenantMembershipId: membership.id, roleId, startDate: now });

  const employeeNumber = `DEMO-${persona.toUpperCase().slice(0, 4)}-01`;
  const [employee] = await db
    .insert(employees)
    .values({
      tenantId,
      employeeNumber,
      firstName: 'Demo',
      lastName: definition.label,
      email,
      phone: `081000${Object.keys(LIVE_DEMO_PERSONAS).indexOf(persona) + 1000}`,
      jobTitle: definition.label,
      employmentType: 'demo',
      employmentStatus: 'active',
      availabilityStatus: 'available',
      isDriver: persona === 'driver',
      userId,
      notes: 'Synthetic employee used only by the public GRN Fleet live demo.',
    })
    .returning({ id: employees.id });

  if (persona === 'driver') {
    const [profile] = await db
      .insert(driverProfiles)
      .values({ employeeId: employee.id, driverStatus: 'authorised', availabilityStatus: 'available' })
      .returning({ id: driverProfiles.id });
    await db.insert(driverLicences).values({
      driverProfileId: profile.id,
      licenceNumber: 'DEMO-LIC-001',
      licenceClass: 'B',
      issueDate: '2024-01-01',
      expiryDate: '2030-12-31',
      holderName: displayName,
      entryMethod: 'demo',
      version: 1,
      isActive: true,
      isVerified: true,
      verificationStatus: 'verified',
      notes: 'Synthetic licence for public demo only.',
    });
  }

  return userId;
}

async function ensureDemoVehicles(tenantId: string) {
  const db = getDb();
  const existing = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.tenantId, tenantId))
    .limit(1);
  if (existing.length) return;

  const year = new Date().getFullYear();
  await db.insert(vehicles).values([
    {
      tenantId,
      licenceNumber: 'DEMO-001',
      make: 'Toyota',
      model: 'Hilux',
      manufactureYear: year - 2,
      vehicleCategory: 'Light utility vehicle',
      vehicleDescription: 'Double cab 4x4',
      fuelType: 'diesel',
      transmission: 'automatic',
      status: 'available',
      currentOdometer: 42850,
      licenceExpiryDate: `${year + 1}-12-31`,
      requiredLicenceClass: 'B',
      seatedCapacity: 5,
      notes: 'Synthetic public demo vehicle.',
    },
    {
      tenantId,
      licenceNumber: 'DEMO-002',
      make: 'Nissan',
      model: 'X-Trail',
      manufactureYear: year - 1,
      vehicleCategory: 'Passenger vehicle',
      vehicleDescription: 'SUV',
      fuelType: 'petrol',
      transmission: 'automatic',
      status: 'available',
      currentOdometer: 21740,
      licenceExpiryDate: `${year + 1}-12-31`,
      requiredLicenceClass: 'B',
      seatedCapacity: 5,
      notes: 'Synthetic public demo vehicle.',
    },
    {
      tenantId,
      licenceNumber: 'DEMO-003',
      make: 'Toyota',
      model: 'Quantum',
      manufactureYear: year - 3,
      vehicleCategory: 'Minibus',
      vehicleDescription: 'Passenger bus',
      fuelType: 'diesel',
      transmission: 'manual',
      status: 'maintenance',
      currentOdometer: 86300,
      licenceExpiryDate: `${year + 1}-12-31`,
      requiredLicenceClass: 'C1',
      seatedCapacity: 14,
      notes: 'Synthetic public demo vehicle; intentionally shown in maintenance.',
    },
  ]);
}

export async function getPublishedLiveDemo() {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({
      sandboxId: demoSandboxes.id,
      tenantId: demoSandboxes.tenantId,
      expiresAt: demoSandboxes.expiresAt,
      metadata: demoSandboxes.metadata,
      tenantName: tenants.name,
    })
    .from(demoSandboxes)
    .innerJoin(tenants, eq(tenants.id, demoSandboxes.tenantId))
    .where(
      and(
        eq(demoSandboxes.status, 'active'),
        eq(demoSandboxes.isActive, true),
        gt(demoSandboxes.expiresAt, now),
        sql`${demoSandboxes.metadata}->>'publicLiveDemo' = 'true'`,
        sql`lower(${tenants.status}) in ('active', 'trial')`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function publishLiveDemoSandbox(sandboxId: string, enabled: boolean) {
  const db = getDb();
  const now = new Date();
  const [sandbox] = await db
    .select({
      id: demoSandboxes.id,
      tenantId: demoSandboxes.tenantId,
      status: demoSandboxes.status,
      isActive: demoSandboxes.isActive,
      expiresAt: demoSandboxes.expiresAt,
      metadata: demoSandboxes.metadata,
    })
    .from(demoSandboxes)
    .where(eq(demoSandboxes.id, sandboxId))
    .limit(1);

  if (!sandbox) throw new Error('Sandbox not found');
  if (enabled && (!sandbox.isActive || sandbox.status !== 'active' || sandbox.expiresAt <= now)) {
    throw new Error('Only an active, unexpired sandbox can be published as the live demo');
  }

  // Only one shared public demo may be published. Private prospect sandboxes
  // remain private and are never discoverable from the public endpoint.
  const allSandboxes = await db
    .select({ id: demoSandboxes.id, metadata: demoSandboxes.metadata })
    .from(demoSandboxes);
  for (const candidate of allSandboxes) {
    if (candidate.id === sandbox.id) continue;
    const metadata = (candidate.metadata ?? {}) as DemoMetadata;
    if (metadata.publicLiveDemo === true) {
      await db
        .update(demoSandboxes)
        .set({ metadata: { ...metadata, publicLiveDemo: false } })
        .where(eq(demoSandboxes.id, candidate.id));
    }
  }

  let personaIds: Partial<Record<LiveDemoPersonaKey, string>> = {};
  if (enabled) {
    await ensureDemoVehicles(sandbox.tenantId);
    for (const persona of Object.keys(LIVE_DEMO_PERSONAS) as LiveDemoPersonaKey[]) {
      personaIds[persona] = await ensurePersona(sandbox.id, sandbox.tenantId, persona);
    }
  }

  const metadata = (sandbox.metadata ?? {}) as DemoMetadata;
  const nextMetadata: DemoMetadata = {
    ...metadata,
    publicLiveDemo: enabled,
    publicDemoPublishedAt: enabled ? now.toISOString() : metadata.publicDemoPublishedAt,
    publicDemoPersonas: enabled ? personaIds : metadata.publicDemoPersonas,
  };
  const [updated] = await db
    .update(demoSandboxes)
    .set({ metadata: nextMetadata })
    .where(eq(demoSandboxes.id, sandbox.id))
    .returning();
  return updated;
}

export function readLiveDemoPersonaUserId(
  metadata: unknown,
  persona: LiveDemoPersonaKey,
): string | null {
  const value = (metadata ?? {}) as DemoMetadata;
  return value.publicDemoPersonas?.[persona] ?? null;
}

export function isLiveDemoPersona(value: unknown): value is LiveDemoPersonaKey {
  return typeof value === 'string' && value in LIVE_DEMO_PERSONAS;
}
