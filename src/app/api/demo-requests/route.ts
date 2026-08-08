/**
 * Demo Request API (Public-facing)
 *
 * POST /api/demo-requests — Submit a demo request (lead capture)
 * GET  /api/demo-requests — List demo requests (platform admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { demoRequests } from '@/db/schema/demo-requests';
import { eq, and, count, type SQL } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { notifyPlatformIntake } from '@/lib/platform/public-intake-notifications';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      email,
      phone,
      organisation,
      organisationType,
      fleetSize,
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

    const org = (organisation ?? company ?? '').trim();
    const orgType = (organisationType ?? industry ?? '').trim();
    const fleetCount =
      typeof fleetSize === 'string' && fleetSize.includes('–')
        ? Number.parseInt(fleetSize.split('–')[1].replace('+', ''), 10)
        : Number.parseInt(String(fleetSize ?? ''), 10) || null;
    const roleValue = (role ?? 'other').trim() || 'other';
    const jobTitleValue = (jobTitle ?? 'Prospective Customer').trim() || 'Prospective Customer';

    if (!name || !email || !org) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, organisation' },
        { status: 400 },
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const db = getDb();
    const normalisedEmail = email.trim().toLowerCase();

    const [existing] = await db
      .select()
      .from(demoRequests)
      .where(and(eq(demoRequests.email, normalisedEmail)))
      .limit(1);

    if (existing && ['new', 'qualified', 'scheduled'].includes(existing.status)) {
      return NextResponse.json(
        { error: 'A demo request from this email is already in progress' },
        { status: 409 },
      );
    }

    const [demoRequest] = await db
      .insert(demoRequests)
      .values({
        name: name.trim(),
        email: normalisedEmail,
        phone: phone || null,
        company: org,
        jobTitle: jobTitleValue,
        role: roleValue,
        industry: orgType || null,
        userCount: userCount || null,
        vehicleCount: vehicleCount ?? fleetCount,
        monthlyCost: monthlyCost || null,
        technicalRequirements: technicalRequirements || null,
        integrationNeeds: integrationNeeds || null,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
        preferredTime: preferredTime || null,
        timezone: timezone || null,
        contactMethod: contactMethod || 'email',
        notes: notes || null,
        status: 'new',
        source: source || 'website',
        sourceDetails: sourceDetails || null,
      })
      .returning();

    await notifyPlatformIntake({
      entityId: demoRequest.id,
      entityType: 'demo_request',
      eventType: 'public_demo_request_submitted',
      title: 'New demo request',
      body: `${demoRequest.company} submitted a demo request through the public website.`,
      actionUrl: `/dashboard/platform/demo-requests?request=${demoRequest.id}`,
      priority: 'high',
    }).catch((notificationError) => {
      console.error('[Demo Requests] Platform notification failed:', notificationError);
    });

    return NextResponse.json({ success: true, data: demoRequest }, { status: 201 });
  } catch (error) {
    console.error('[Demo Requests] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

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
    const conditions: SQL<unknown>[] = [];
    if (status) conditions.push(eq(demoRequests.status, status as never));

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
      data: { requests, total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('[Demo Requests] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
