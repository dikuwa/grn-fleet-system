import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { demoRequests, demoSandboxes } from '@/db/schema/demo-requests';
import { subscriptionPackages } from '@/db/schema/packages';
import { tenants } from '@/db/schema/tenants';
import { createSubscription } from '@/lib/platform/subscriptions';
import { publishLiveDemoSandbox } from '@/lib/public-demo';
import { ensureLiveDemoOperationalSetup } from '@/lib/live-demo-operational-setup';

const PUBLIC_DEMO_DAYS = 30;

export async function createDedicatedLiveDemoSandbox(createdByUserId: string) {
  const db = getDb();
  const now = new Date();

  const existing = await db
    .select({
      sandboxId: demoSandboxes.id,
      tenantId: demoSandboxes.tenantId,
      expiresAt: demoSandboxes.expiresAt,
      metadata: demoSandboxes.metadata,
      status: demoSandboxes.status,
      isActive: demoSandboxes.isActive,
    })
    .from(demoSandboxes)
    .where(eq(demoSandboxes.status, 'active'));
  const current = existing.find(
    (row) =>
      row.isActive &&
      row.expiresAt > now &&
      (row.metadata as Record<string, unknown> | null)?.systemLiveDemo === true,
  );
  if (current) {
    await publishLiveDemoSandbox(current.sandboxId, true);
    await ensureLiveDemoOperationalSetup({
      tenantId: current.tenantId,
      actorUserId: createdByUserId,
    });
    return { sandboxId: current.sandboxId, expiresAt: current.expiresAt, reused: true };
  }

  const [pkg] = await db
    .select({ id: subscriptionPackages.id })
    .from(subscriptionPackages)
    .where(
      and(
        eq(subscriptionPackages.status, 'active'),
        isNotNull(subscriptionPackages.priceMonthlyCents),
      ),
    )
    .orderBy(asc(subscriptionPackages.sortOrder))
    .limit(1);
  if (!pkg) {
    throw new Error('Create at least one active monthly package before creating the live demo.');
  }

  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const expiresAt = new Date(now.getTime() + PUBLIC_DEMO_DAYS * 24 * 60 * 60_000);
  let demoRequestId: string | null = null;
  let tenantId: string | null = null;

  try {
    const [demoRequest] = await db
      .insert(demoRequests)
      .values({
        name: 'GRN Fleet Live Demo',
        email: `live-demo-${suffix}@govfleet.local`,
        company: 'GRN Fleet Demonstration Organisation',
        jobTitle: 'System Demo',
        role: 'public_demo',
        industry: 'Fleet Operations',
        contactMethod: 'system',
        status: 'qualified',
        qualifiedByUserId: createdByUserId,
        qualifiedAt: now,
        source: 'live_demo_system',
        sourceDetails: 'System-owned public demo template. Not a prospect lead.',
        metadata: { systemLiveDemo: true },
      })
      .returning({ id: demoRequests.id });
    demoRequestId = demoRequest.id;

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: 'GRN Fleet Demonstration Organisation',
        code: `LDM${suffix.slice(0, 5).toUpperCase()}`,
        slug: `live-demo-${suffix}`,
        type: 'demo_sandbox',
        status: 'TRIAL',
        lifecycleStatus: 'ACTIVE',
        createdByUserId,
        primaryContactName: 'GRN Fleet Live Demo',
        primaryContactEmail: `live-demo-${suffix}@govfleet.local`,
        lifecycleReason: 'System-owned public product demo',
        lifecycleChangedAt: now,
        timezone: 'Africa/Windhoek',
        locale: 'en-NA',
        metadata: {
          isDemoSandbox: true,
          systemLiveDemo: true,
          expiresAt: expiresAt.toISOString(),
        },
      })
      .returning({ id: tenants.id });
    tenantId = tenant.id;

    await createSubscription({
      tenantId,
      packageId: pkg.id,
      billingInterval: 'monthly',
      status: 'trialing',
      trialDays: PUBLIC_DEMO_DAYS,
    });

    const [sandbox] = await db
      .insert(demoSandboxes)
      .values({
        demoRequestId,
        tenantId,
        packageId: pkg.id,
        adminUserId: 'system:live-demo',
        adminEmail: `live-demo-${suffix}@govfleet.local`,
        isPasswordTemporary: false,
        status: 'active',
        isActive: true,
        expiresAt,
        metadata: {
          systemLiveDemo: true,
          publicLiveDemo: false,
          createdByUserId,
        },
      })
      .returning({ id: demoSandboxes.id });

    await publishLiveDemoSandbox(sandbox.id, true);
    await ensureLiveDemoOperationalSetup({ tenantId, actorUserId: createdByUserId });
    return { sandboxId: sandbox.id, expiresAt, reused: false };
  } catch (error) {
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => {});
    if (demoRequestId)
      await db.delete(demoRequests).where(eq(demoRequests.id, demoRequestId)).catch(() => {});
    throw error;
  }
}
