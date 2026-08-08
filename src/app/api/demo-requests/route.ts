/**
 * Demo Request API (Public-facing)
 *
 * POST /api/demo-requests — Submit a demo request (lead capture)
 * GET  /api/demo-requests — Legacy authenticated list endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { demoRequests } from '@/db/schema/demo-requests';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { notifyPlatformIntake } from '@/lib/platform/public-intake-notifications';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name, email, phone, organisation, organisationType, fleetSize, company, jobTitle, role,
      industry, userCount, vehicleCount, monthlyCost, technicalRequirements, integrationNeeds,
      preferredDate, preferredTime, timezone, contactMethod, notes, source, sourceDetails,
    } = body;

    const org = (organisation ?? company ?? '').trim();
    const orgType = (organisationType ?? industry ?? '').trim();
    const fleetCount = typeof fleetSize === 'string' && fleetSize.includes('–')
      ? Number.parseInt(fleetSize.split('–')[1].replace('+', ''), 10)
      : Number.parseInt(String(fleetSize ?? ''), 10) || null;
    const roleValue = (role ?? 'other').trim() || 'other';
    const jobTitleValue = (jobTitle ?? 'Prospective Customer').trim() || 'Prospective Customer';

    if (!name || !email || !org) {
      return NextResponse.json({ error: 'Missing required fields: name, email, organisation' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const db = getDb();
    const normalisedEmail = email.trim().toLowerCase();
    const [existing] = await db.select().from(demoRequests).where(eq(demoRequests.email, normalisedEmail)).limit(1);

    if (existing && ['new', 'qualified', 'scheduled'].includes(existing.status)) {
      return NextResponse.json({ error: 'A demo request from this email is already in progress' }, { status: 409 });
    }

    const values = {
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
      status: 'new' as const,
      source: source || 'website',
      sourceDetails: sourceDetails || null,
      qualifiedByUserId: null,
      qualifiedAt: null,
      scheduledDemoAt: null,
      scheduledDemoLink: null,
      lastContactAt: null,
      nextContactAt: null,
      contactNotes: null,
      updatedAt: new Date(),
    };

    // Email is intentionally unique in the current schema. A prospect who
    // returns after a completed/cancelled evaluation reopens the same lead
    // record instead of failing on the database uniqueness constraint.
    const [demoRequest] = existing
      ? await db.update(demoRequests).set(values).where(eq(demoRequests.id, existing.id)).returning()
      : await db.insert(demoRequests).values(values).returning();

    await notifyPlatformIntake({
      entityId: demoRequest.id,
      entityType: 'demo_request',
      eventType: 'public_demo_request_submitted',
      title: existing ? 'Demo request reopened' : 'New demo request',
      body: `${demoRequest.company} submitted a demo request through the public website.`,
      actionUrl: `/dashboard/platform/demo-requests?request=${demoRequest.id}`,
      priority: 'high',
    }).catch((notificationError) => console.error('[Demo Requests] Platform notification failed:', notificationError));

    return NextResponse.json({ success: true, data: demoRequest }, { status: existing ? 200 : 201 });
  } catch (error) {
    console.error('[Demo Requests] POST failed:', error);
    return NextResponse.json({ error: 'Unable to submit demo request. Please try again.' }, { status: 500 });
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
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '25', 10) || 25));
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [];
    if (status) conditions.push(eq(demoRequests.status, status as never));
    const where = conditions.length ? and(...conditions) : undefined;
    const db = getDb();
    const [[totalRow], requests] = await Promise.all([
      db.select({ count: count() }).from(demoRequests).where(where),
      db.select().from(demoRequests).where(where).orderBy(desc(demoRequests.createdAt)).limit(limit).offset(offset),
    ]);
    const total = Number(totalRow?.count ?? 0);
    return NextResponse.json({ success: true, data: { requests, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) {
    console.error('[Demo Requests] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load demo requests' }, { status: 500 });
  }
}
