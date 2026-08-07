/**
 * Demo Request API (Public-facing)
 *
 * POST /api/demo-requests — Submit a demo request (lead capture)
 * GET  /api/demo-requests — List demo requests (platform admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { demoRequests } from '@/db/schema/demo-requests';
import { eq, and, count } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// POST — Submit a demo request
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      phone,
      company,
      jobTitle,
      role,
      industry,
      userCount,
      vehicleCount,
      monthlyCost,
      technicalRequirements,
      integrationNeeds,
      preferredDate,
      preferredTime,
      timezone,
      contactMethod,
      notes,
      source,
      sourceDetails,
    } = body;

    // Validate required fields
    if (!name || !email || !company || !jobTitle || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, company, jobTitle, role' },
        { status: 400 },
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const db = getDb();

    // Check for an existing request from the same email that is still active
    const [existing] = await db
      .select()
      .from(demoRequests)
      .where(
        and(
          eq(demoRequests.email, email.toLowerCase()),
          // Only block if the prior request hasn't been completed/cancelled
        ),
      )
      .limit(1);

    if (existing && ['new', 'qualified', 'scheduled'].includes(existing.status)) {
      return NextResponse.json(
        { error: 'A demo request from this email is already in progress' },
        { status: 409 },
      );
    }

    // Create the demo request
    const [demoRequest] = await db
      .insert(demoRequests)
      .values({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone || null,
        company: company.trim(),
        jobTitle: jobTitle.trim(),
        role,
        industry: industry || null,
        userCount: userCount || null,
        vehicleCount: vehicleCount || null,
        monthlyCost: monthlyCost || null,
        technicalRequirements: technicalRequirements || null,
        integrationNeeds: integrationNeeds || null,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
        preferredTime: preferredTime || null,
        timezone: timezone || null,
        contactMethod: contactMethod || 'email',
        notes: notes || null,
        status: 'new',
        source: source || null,
        sourceDetails: sourceDetails || null,
      })
      .returning();

    return NextResponse.json({
      success: true,
      data: demoRequest,
    }, { status: 201 });
  } catch (error) {
    console.error('[Demo Requests] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — List demo requests (Platform Admin only - future feature)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);
    const offset = (page - 1) * limit;

    const db = getDb();

    const conditions: any[] = [];
    if (status) conditions.push(eq(demoRequests.status, status as any));

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(demoRequests)
      .where(and(...conditions));

    const total = totalResult?.count || 0;

    const requests = await db
      .select()
      .from(demoRequests)
      .where(and(...conditions))
      .orderBy(demoRequests.createdAt)
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      success: true,
      data: {
        requests,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Demo Requests] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}