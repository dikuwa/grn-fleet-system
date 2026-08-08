/**
 * Tenant Setup Wizard API
 *
 * GET  /api/platform/setup — Load setup progress for the current tenant
 * POST /api/platform/setup — Save setup progress (partial update, supports save-and-resume)
 *
 * Manages the 11-step tenant setup wizard with save-and-resume capability.
 * Steps:
 *   0. Organisation Profile
 *   1. Departments
 *   2. Offices
 *   3. Vehicle Defaults
 *   4. Driver Setup
 *   5. Fuel/Odometer Settings
 *   6. Inspection Rules
 *   7. Notification Preferences
 *   8. Role Assignments
 *   9. Branding
 *  10. Review & Complete
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenantSetupProgress } from '@/db/schema/invitations';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { offices, departments } from '@/db/schema/people';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { seedDefaultIncidentCategories } from '@/lib/incidents/categories';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 11;

interface SetupProgressData {
  currentStep: number;
  completedSteps: number[];
  stepData: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// GET — Load progress
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const tenantId = session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    // Get tenant info
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Get setup progress
    const [progress] = await db
      .select()
      .from(tenantSetupProgress)
      .where(eq(tenantSetupProgress.tenantId, tenantId))
      .limit(1);

    // Get existing offices and departments
    const tenantOffices = await db
      .select()
      .from(offices)
      .where(eq(offices.tenantId, tenantId));

    const tenantDepts = await db
      .select()
      .from(departments)
      .where(eq(departments.tenantId, tenantId));

    // Get branding
    const [branding] = await db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, tenantId))
      .limit(1);

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
        progress: progress
          ? {
              currentStep: progress.currentStep,
              completedSteps: progress.completedSteps ?? [],
              stepData: progress.stepData ?? {},
              isReady: progress.isReady,
            }
          : {
              currentStep: 0,
              completedSteps: [],
              stepData: {},
              isReady: false,
            },
        offices: tenantOffices,
        departments: tenantDepts,
        branding,
        totalSteps: TOTAL_STEPS,
      },
    });
  } catch (error) {
    console.error('[Setup] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Save progress
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const tenantId = session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    const body: SetupProgressData & { action?: string } = await request.json();
    const { currentStep, completedSteps, stepData, action } = body;

    const db = getDb();
    const now = new Date();

    // Finalize action — marks setup complete and flips the tenant lifecycle
    if (action === 'complete') {
      await db
        .update(tenants)
        .set({
          lifecycleStatus: 'PENDING_PLATFORM_REVIEW',
          lifecycleChangedAt: now,
          updatedAt: now,
        })
        .where(eq(tenants.id, tenantId));

      await db
        .update(tenantSetupProgress)
        .set({
          isReady: true,
          readinessScore: 100,
          completedSteps: Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => i),
          updatedAt: now,
        })
        .where(eq(tenantSetupProgress.tenantId, tenantId));

      // Seed default incident categories for the tenant (fire-and-forget)
      await seedDefaultIncidentCategories(tenantId, session.user.id).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { lifecycleStatus: 'PENDING_PLATFORM_REVIEW' },
      });
    }

    if (currentStep < 0 || currentStep >= TOTAL_STEPS) {
      return NextResponse.json({ error: 'Invalid step number' }, { status: 400 });
    }

    // Check existing progress
    const [existing] = await db
      .select({ id: tenantSetupProgress.id })
      .from(tenantSetupProgress)
      .where(eq(tenantSetupProgress.tenantId, tenantId))
      .limit(1);

    const isReady = completedSteps.length >= TOTAL_STEPS - 1; // All steps except Review

    if (existing) {
      await db
        .update(tenantSetupProgress)
        .set({
          currentStep,
          completedSteps: completedSteps ?? [],
          stepData: stepData ?? {},
          lastSavedAt: now,
          isReady,
          readinessScore: Math.round(((completedSteps?.length ?? 0) / TOTAL_STEPS) * 100),
          updatedAt: now,
        })
        .where(eq(tenantSetupProgress.id, existing.id));
    } else {
      await db.insert(tenantSetupProgress).values({
        tenantId,
        currentStep,
        completedSteps: completedSteps ?? [],
        stepData: stepData ?? {},
        totalSteps: TOTAL_STEPS,
        lastSavedAt: now,
        isReady,
        readinessScore: Math.round(((completedSteps?.length ?? 0) / TOTAL_STEPS) * 100),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Setup] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
