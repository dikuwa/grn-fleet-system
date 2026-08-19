/**
 * Tenant Workspace Setup API
 *
 * The setup wizard intentionally contains only configuration that GovFleet
 * persists and uses operationally:
 *   0. Organisation review (required)
 *   1. Departments / units (optional)
 *   2. Offices / depots (required)
 *   3. Branding / contacts (optional)
 *   4. Review and complete initial setup
 *
 * Completing this wizard keeps the tenant in SETUP_IN_PROGRESS so the Tenant
 * Administrator can finish Operational Setup (notably the approval workflow)
 * before explicitly submitting the tenant for Platform Review.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenantSetupProgress } from '@/db/schema/invitations';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { offices, departments } from '@/db/schema/people';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { seedTenantOperationalDefaults } from '@/lib/platform/tenant-operational-defaults';
import { recordAuditEvent } from '@/lib/audit-event';
import { and, count, eq } from 'drizzle-orm';

const TOTAL_STEPS = 5;
const REQUIRED_SETUP_STEPS = [0, 2] as const;
const NON_ONBOARDING_LIFECYCLES = new Set([
  'READY_FOR_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'RESTRICTED',
  'ARCHIVED',
]);
const SETUP_LIFECYCLE = 'SETUP_IN_PROGRESS';

interface SetupProgressData {
  currentStep: number;
  completedSteps: number[];
  stepData: Record<string, unknown>;
}

async function requireTenantSetupAccess(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
}

function normaliseLegacyProgress(progress: {
  currentStep: number;
  completedSteps: number[] | null;
  totalSteps: number;
}) {
  const completed = Array.isArray(progress.completedSteps) ? progress.completedSteps : [];
  if (progress.totalSteps === TOTAL_STEPS) {
    return {
      currentStep: Math.min(Math.max(progress.currentStep, 0), TOTAL_STEPS - 1),
      completedSteps: completed.filter((step) => Number.isInteger(step) && step >= 0 && step < TOTAL_STEPS),
    };
  }

  const mapped = new Set<number>();
  if (completed.includes(0)) mapped.add(0);
  if (completed.includes(1)) mapped.add(1);
  if (completed.includes(2)) mapped.add(2);
  if (completed.includes(9)) mapped.add(3);
  if (completed.includes(10)) mapped.add(4);

  let currentStep = 0;
  if (progress.currentStep >= 10) currentStep = 4;
  else if (progress.currentStep >= 9) currentStep = 3;
  else if (progress.currentStep >= 2) currentStep = 2;
  else if (progress.currentStep >= 1) currentStep = 1;

  return { currentStep, completedSteps: [...mapped].sort((a, b) => a - b) };
}

function validateProgress(input: SetupProgressData) {
  if (!Number.isInteger(input.currentStep) || input.currentStep < 0 || input.currentStep >= TOTAL_STEPS) {
    return 'Invalid setup step.';
  }
  if (
    !Array.isArray(input.completedSteps)
    || input.completedSteps.some((step) => !Number.isInteger(step) || step < 0 || step >= TOTAL_STEPS)
  ) {
    return 'Invalid completed step data.';
  }
  if (!input.stepData || typeof input.stepData !== 'object' || Array.isArray(input.stepData)) {
    return 'Invalid setup data.';
  }
  return null;
}

function requiredReadinessScore(completedSteps: number[]) {
  const ready = REQUIRED_SETUP_STEPS.filter((step) => completedSteps.includes(step)).length;
  return Math.round((ready / REQUIRED_SETUP_STEPS.length) * 100);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantSetupAccess(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const tenantId = session.tenantId;
    if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });

    const db = getDb();
    const [[tenant], [progress], tenantOffices, tenantDepts, [branding]] = await Promise.all([
      db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
      db.select().from(tenantSetupProgress).where(eq(tenantSetupProgress.tenantId, tenantId)).limit(1),
      db.select().from(offices).where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true))),
      db.select().from(departments).where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true))),
      db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1),
    ]);

    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const normalised = progress
      ? normaliseLegacyProgress({
          currentStep: progress.currentStep,
          completedSteps: progress.completedSteps,
          totalSteps: progress.totalSteps,
        })
      : { currentStep: 0, completedSteps: [] as number[] };

    return NextResponse.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          code: tenant.code,
          slug: tenant.slug,
          type: tenant.type,
          timezone: tenant.timezone,
          locale: tenant.locale,
          lifecycleStatus: tenant.lifecycleStatus,
        },
        progress: {
          currentStep: normalised.currentStep,
          completedSteps: normalised.completedSteps,
          stepData: progress?.stepData ?? {},
          isReady: REQUIRED_SETUP_STEPS.every((step) => normalised.completedSteps.includes(step)),
        },
        offices: tenantOffices,
        departments: tenantDepts,
        branding: branding ?? null,
        totalSteps: TOTAL_STEPS,
        requiredSteps: [...REQUIRED_SETUP_STEPS],
      },
    });
  } catch (error) {
    console.error('[Setup] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load workspace setup' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantSetupAccess(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const tenantId = session.tenantId;
    if (!tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 400 });

    const body = (await request.json()) as SetupProgressData & { action?: string };
    const progressInput: SetupProgressData = {
      currentStep: body.currentStep,
      completedSteps: body.completedSteps,
      stepData: body.stepData,
    };
    const validationError = validateProgress(progressInput);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const db = getDb();
    const now = new Date();
    const completedSteps = [...new Set(body.completedSteps)].sort((a, b) => a - b);

    const [[tenant], [storedProgress]] = await Promise.all([
      db
        .select({ id: tenants.id, lifecycleStatus: tenants.lifecycleStatus })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
      db
        .select({
          id: tenantSetupProgress.id,
          currentStep: tenantSetupProgress.currentStep,
          completedSteps: tenantSetupProgress.completedSteps,
          totalSteps: tenantSetupProgress.totalSteps,
        })
        .from(tenantSetupProgress)
        .where(eq(tenantSetupProgress.tenantId, tenantId))
        .limit(1),
    ]);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    if (body.action === 'complete') {
      if (tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW') {
        return NextResponse.json({
          success: true,
          data: { lifecycleStatus: tenant.lifecycleStatus, nextHref: '/dashboard/setup/operational' },
        });
      }
      if (tenant.lifecycleStatus !== SETUP_LIFECYCLE) {
        return NextResponse.json(
          { error: `Initial workspace setup can only be completed while the tenant lifecycle is ${SETUP_LIFECYCLE}. Current lifecycle: ${tenant.lifecycleStatus}.` },
          { status: 409 },
        );
      }
      if (!storedProgress) {
        return NextResponse.json({ error: 'Save Organisation and Offices before completing initial setup.' }, { status: 409 });
      }

      const persisted = normaliseLegacyProgress({
        currentStep: storedProgress.currentStep,
        completedSteps: storedProgress.completedSteps,
        totalSteps: storedProgress.totalSteps,
      });
      if (!REQUIRED_SETUP_STEPS.every((step) => persisted.completedSteps.includes(step))) {
        return NextResponse.json(
          { error: 'Confirm Organisation and save at least one Office or Depot before completing initial setup.' },
          { status: 409 },
        );
      }

      const [officeCount] = await db
        .select({ total: count() })
        .from(offices)
        .where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true)));
      if (Number(officeCount?.total ?? 0) < 1) {
        return NextResponse.json(
          { error: 'At least one active office or depot is required before initial setup can be completed.' },
          { status: 409 },
        );
      }

      const finalCompleted = [...new Set([...persisted.completedSteps, ...completedSteps, ...REQUIRED_SETUP_STEPS, TOTAL_STEPS - 1])]
        .sort((a, b) => a - b);

      await db.transaction(async (tx) => {
        await tx
          .update(tenantSetupProgress)
          .set({
            currentStep: TOTAL_STEPS - 1,
            completedSteps: finalCompleted,
            totalSteps: TOTAL_STEPS,
            stepData: body.stepData,
            isReady: true,
            readinessScore: 100,
            lastSavedAt: now,
            updatedAt: now,
          })
          .where(eq(tenantSetupProgress.id, storedProgress.id));

        await tx
          .update(tenants)
          .set({
            currentOnboardingStep: TOTAL_STEPS - 1,
            lifecycleReason: 'Initial workspace setup complete; operational setup in progress',
            updatedAt: now,
          })
          .where(eq(tenants.id, tenantId));

        await recordAuditEvent({
          tenantId,
          actorUserId: session.user.id,
          eventType: 'tenant_initial_setup_completed',
          action: 'complete',
          entityType: 'tenant',
          entityId: tenantId,
          before: { lifecycleStatus: tenant.lifecycleStatus },
          after: { lifecycleStatus: SETUP_LIFECYCLE, initialSetupReady: true },
          summary: 'Initial workspace setup completed; operational setup remains available',
        }, tx);
      });

      // Safe backfill for tenants created before operational defaults were part
      // of platform onboarding. Failure here does not undo valid initial setup.
      await seedTenantOperationalDefaults({
        tenantId,
        actorUserId: session.user.id,
      }).catch(() => undefined);

      return NextResponse.json({
        success: true,
        data: {
          lifecycleStatus: SETUP_LIFECYCLE,
          initialSetupReady: true,
          nextHref: '/dashboard/setup/operational',
        },
      });
    }

    if (NON_ONBOARDING_LIFECYCLES.has(tenant.lifecycleStatus) || tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW') {
      return NextResponse.json(
        { error: `Initial workspace setup is closed while the tenant lifecycle is ${tenant.lifecycleStatus}. Use Tenant Settings and Organisation Management for normal changes.` },
        { status: 409 },
      );
    }

    const isReady = REQUIRED_SETUP_STEPS.every((step) => completedSteps.includes(step));
    const readinessScore = requiredReadinessScore(completedSteps);

    await db.transaction(async (tx) => {
      if (storedProgress) {
        await tx
          .update(tenantSetupProgress)
          .set({
            currentStep: body.currentStep,
            completedSteps,
            totalSteps: TOTAL_STEPS,
            stepData: body.stepData,
            lastSavedAt: now,
            isReady,
            readinessScore,
            updatedAt: now,
          })
          .where(eq(tenantSetupProgress.id, storedProgress.id));
      } else {
        await tx.insert(tenantSetupProgress).values({
          tenantId,
          currentStep: body.currentStep,
          completedSteps,
          totalSteps: TOTAL_STEPS,
          stepData: body.stepData,
          lastSavedAt: now,
          isReady,
          readinessScore,
        });
      }

      if (tenant.lifecycleStatus === SETUP_LIFECYCLE) {
        await tx
          .update(tenants)
          .set({ currentOnboardingStep: body.currentStep, updatedAt: now })
          .where(eq(tenants.id, tenantId));
      }
    });

    return NextResponse.json({ success: true, data: { isReady } });
  } catch (error) {
    console.error('[Setup] POST failed:', error);
    return NextResponse.json({ error: 'Failed to save workspace setup' }, { status: 500 });
  }
}
