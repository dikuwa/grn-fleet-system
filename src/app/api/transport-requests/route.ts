import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests, requestActivities, requestPassengers, requestDrivers, requestRoutes } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { getServerSessionFromRequest } from '@/lib/session';
import { onRequestSubmitted } from '@/lib/document-generator';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const {
      purpose,
      department,
      scope,
      specialAuthorityRequired,
      specialAuthorityReason,
      requesterEmployeeNumber,
      activities,
      passengers,
      drivers,
      routes,
    } = body;

    // Validate required fields
    if (!purpose?.trim()) {
      return NextResponse.json({ error: 'Purpose is required' }, { status: 400 });
    }
    if (!scope) {
      return NextResponse.json({ error: 'Scope is required' }, { status: 400 });
    }

    const db = getDb();
    const session = await getServerSessionFromRequest(req);
    const userId = session?.user.id || body.userId || 'system';
    const tenantId = session?.tenantId || body.tenantId || '00000000-0000-0000-0000-000000000001';

    // Look up the requester employee — accept employeeNumber from form or resolve from session user
    let requesterEmployeeId: string;
    if (requesterEmployeeNumber?.trim()) {
      const [found] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.employeeNumber, requesterEmployeeNumber))
        .limit(1);
      if (!found) {
        return NextResponse.json({ error: 'Requester employee not found' }, { status: 404 });
      }
      requesterEmployeeId = found.id;
    } else {
      // Fall back to finding employee by linked user ID
      const [found] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.userId, userId))
        .limit(1);
      if (!found) {
        return NextResponse.json({ error: 'Could not identify requester. Log in or provide employee number.' }, { status: 400 });
      }
      requesterEmployeeId = found.id;
    }

    // Generate a reference number
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 900) + 100);
    const reference = `GRN/TR/${now.getFullYear()}/${month}${day}/${seq}`;

    // Calculate total authorised kilometres from routes/activities
    const routeKm = (routes || []).reduce((sum: number, r: { estimatedKm?: number }) => sum + (r.estimatedKm || 0), 0);
    const activityKm = (activities || []).reduce((sum: number, a: { estimatedKilometres?: number }) => sum + (a.estimatedKilometres || 0), 0);
    const totalKm = Math.max(routeKm, activityKm);

    // Insert the transport request
    const [request] = await db
      .insert(transportRequests)
      .values({
        tenantId,
        reference,
        scope,
        status: 'submitted',
        requesterEmployeeId,
        requesterUserId: userId,
        department: department || null,
        purpose,
        specialAuthorityRequired: specialAuthorityRequired || false,
        specialAuthorityReason: specialAuthorityReason || null,
        totalAuthorisedKilometres: totalKm || null,
        submittedAt: new Date(),
      })
      .returning();

    // Insert activities
    if (activities?.length > 0) {
      await db.insert(requestActivities).values(
        activities.map((a: { title: string; description?: string; venue?: string; startDate: string; endDate: string; estimatedKilometres?: number }) => ({
          requestId: request.id,
          title: a.title,
          description: a.description || null,
          venue: a.venue || null,
          startDate: new Date(a.startDate),
          endDate: new Date(a.endDate),
          estimatedKilometres: a.estimatedKilometres || null,
        })),
      );
    }

    // Insert passengers
    if (passengers?.length > 0) {
      await db.insert(requestPassengers).values(
        passengers.map((p: { type: string; employeeId?: string; externalName?: string }) => ({
          requestId: request.id,
          employeeId: p.type === 'employee' && p.employeeId ? p.employeeId : null,
          externalName: p.type === 'external' ? (p.externalName || null) : null,
          status: 'confirmed',
        })),
      );
    }

    // Insert drivers
    if (drivers?.length > 0) {
      await db.insert(requestDrivers).values(
        drivers.map((d: { employeeId: string; driverType: string; sortOrder: number }, i: number) => ({
          requestId: request.id,
          employeeId: d.employeeId,
          driverType: d.driverType,
          sortOrder: d.sortOrder || i + 1,
        })),
      );
    }

    // Insert routes
    if (routes?.length > 0) {
      await db.insert(requestRoutes).values(
        routes.map((r: { originName: string; destinationName: string; estimatedKm?: number }) => ({
          requestId: request.id,
          originName: r.originName,
          destinationName: r.destinationName,
          totalKilometres: r.estimatedKm || 0,
          additionalKilometres: 0,
          isVerified: false,
        })),
      );
    }

    // Trigger document generation
    const doc = await onRequestSubmitted(request.id, tenantId, userId);

    return NextResponse.json({ request, document: doc, reference });
  } catch (error) {
    console.error('[transport-requests] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to submit transport request' },
      { status: 500 },
    );
  }
}
