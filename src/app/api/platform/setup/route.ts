/**
 * Tenant Workspace Setup API
 *
 * The setup wizard intentionally contains only configuration that GovFleet
 * persists and uses operationally:
 *   0. Organisation review
 *   1. Departments / units
 *   2. Offices / depots
 *   3. Branding / contacts
 *   4. Review and submit
 *
 * Operational rules such as licence verification, trip overlap prevention,
 * inspections and role contracts are enforced by their authoritative modules
 * and are not duplicated as inert setup toggles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenantSetupProgress } from '@/db/schema/invitations';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { offices, departments } from '@/db/schema/people';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { seedDefaultIncidentCategories } from '@/lib/incidents/categories';
import { recordAuditEvent } from '@/lib/audit-event';
import { and, count, eq } from 'drizzle-orm';

const TOTAL_STEPS = 5;
const REQUIRED_SETUP_STEPS = [0, 1, 2, 3] as const;
const NON_ONBOARDING_LIFECYCLES = new Set([
  'READY_FOR_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'RESTRICTED',
  'ARCHIVED',
]);

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

  // Previous setup versions used 11 steps. Only steps that map to persisted,
  // real configuration are carried forward.
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

    const [tenant] = await db
      .select({ id: tenants.id, lifecycleStatus: tenants.lifecycleStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    if (body.action === 'complete') {
      if (tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW') {
        return NextResponse.json({ success: true, data: { lifecycleStatus: tenant.lifecycleStatus } });
      }
      if (NON_ONBOARDING_LIFECYCLES.has(tenant.lifecycleStatus)) {
        return NextResponse.json(
          { error: `Workspace setup cannot be submitted while the tenant lifecycle is ${tenant.lifecycleStatus}.` },
          { status: 409 },
        );
      }
      if (!REQUIRED_SETUP_STEPS.every((step) => completedSteps.includes(step))) {
        return NextResponse.json(
          { error: 'Complete Organisation, Departments, Offices and Branding before submitting setup.' },
          { status: 409 },
        );
      }

      const [officeCount] = await db
        .select({ total: count() })
        .from(offices)
        .where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true)));
      if (Number(officeCount?.total ?? 0) < 1) {
        return NextResponse.json(
          { error: 'At least one active office or depot is required before setup can be submitted.' },
          { status: 409 },
        );
      }

      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: tenantSetupProgress.id })
          .from(tenantSetupProgress)
          .where(eq(tenantSetupProgress.tenantId, tenantId))
          .limit(1);

        if (existing) {
          await tx
            .update(tenantSetupProgress)
            .set({
              currentStep: TOTAL_STEPS - 1,
              completedSteps: [...REQUIRED_SETUP_STEPS, TOTAL_STEPS - 1],
              totalSteps: TOTAL_STEPS,
              stepData: body.stepData,
              isReady: true,
              readinessScore: 100,
              lastSavedAt: now,
              updatedAt: now,
            })
            .where(eq(tenantSetupProgress.id, existing.id));
        } else {
          await tx.insert(tenantSetupProgress).values({
            tenantId,
            currentStep: TOTAL_STEPS - 1,
            completedSteps: [...REQUIRED_SETUP_STEPS, TOTAL_STEPS - 1],
            totalSteps: TOTAL_STEPS,
            stepData: body.stepData,
            isReady: true,
            readinessScore: 100,
            lastSavedAt: now,
          });
        }

        await tx
          .update(tenants)
          .set({
            lifecycleStatus: 'PENDING_PLATFORM_REVIEW',
            currentOnboardingStep: TOTAL_STEPS - 1,
            lifecycleReason: 'Tenant workspace setup submitted for platform review',
            lifecycleChangedAt: now,
            updatedAt: now,
          })
          .where(eq(tenants.id, tenantId));

        await recordAuditEvent({
          tenantId,
          actorUserId: session.user.id,
          eventType: 'tenant_setup_submitted',
          action: 'submit',
          entityType: 'tenant',
          entityId: tenantId,
          before: { lifecycleStatus: tenant.lifecycleStatus },
          after: { lifecycleStatus: 'PENDING_PLATFORM_REVIEW', totalSteps: TOTAL_STEPS },
          summary: 'Tenant workspace setup submitted for platform review',
        }, tx);
      });

      await seedDefaultIncidentCategories(tenantId, session.user.id).catch(() => undefined);
      return NextResponse.json({
        success: true,
        data: { lifecycleStatus: 'PENDING_PLATFORM_REVIEW' },
      });
    }

    const [existing] = await db
      .select({ id: tenantSetupProgress.id })
      .from(tenantSetupProgress)
      .where(eq(tenantSetupProgress.tenantId, tenantId))
      .limit(1);
    const isReady = REQUIRED_SETUP_STEPS.every((step) => completedSteps.includes(step));
    const readinessScore = Math.round((completedSteps.length / (TOTAL_STEPS - 1)) * 100);

    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(tenantSetupProgress)
          .set({
            currentStep: body.currentStep,
            completedSteps,
            totalSteps: TOTAL_STEPS,
            stepData: body.stepData,
            lastSavedAt: now,
            isReady,
            readinessScore: Math.min(100, readinessScore),
            updatedAt: now,
          })
          .where(eq(tenantSetupProgress.id, existing.id));
      } else {
        await tx.insert(tenantSetupProgress).values({
          tenantId,
          currentStep: body.currentStep,
          completedSteps,
          totalSteps: TOTAL_STEPS,
          stepData: body.stepData,
          lastSavedAt: now,
          isReady,
          readinessScore: Math.min(100, readinessScore),
        });
      }

      if (!NON_ONBOARDING_LIFECYCLES.has(tenant.lifecycleStatus) && tenant.lifecycleStatus !== 'PENDING_PLATFORM_REVIEW') {
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
