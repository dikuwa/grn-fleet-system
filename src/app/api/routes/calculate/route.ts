import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { calculateRoute, calculateMultiRoute, isRouteCalculatorConfigured } from '@/lib/route-calculator';
import { getDb } from '@/db';
import { requestRoutes, transportRequests } from '@/db/schema/requests';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/routes/calculate
 *
 * Calculate a route (or multi-leg route) using Google Maps Distance Matrix API.
 * If configured, automatically saves the result back to the request_routes table.
 *
 * Body (single route):
 *   { origin: string, destination: string, requestId?: string }
 *
 * Body (multi-leg):
 *   { legs: [{ origin, destination }], requestId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.REQUEST_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    // Check if route calculator is configured
    if (!isRouteCalculatorConfigured()) {
      return NextResponse.json(
        {
          error: 'Route calculation is not configured. Set GOOGLE_MAPS_SERVER_API_KEY in your environment.',
          configured: false,
        },
        { status: 503 },
      );
    }

    const body = await req.json();
    const { origin, destination, legs, requestId } = body;

    let result;

    if (legs && Array.isArray(legs) && legs.length > 0) {
      // Multi-leg calculation
      result = await calculateMultiRoute(legs);
    } else if (origin && destination) {
      // Single route calculation
      const single = await calculateRoute(origin, destination);
      result = single ? { routes: [single], totalDistanceKm: single.distanceKm, totalDurationMinutes: single.durationMinutes } : null;
    } else {
      return NextResponse.json(
        { error: 'Provide either origin+destination, or legs array.' },
        { status: 400 },
      );
    }

    if (!result) {
      return NextResponse.json(
        { error: 'Could not calculate the route. Check location names and try again.' },
        { status: 422 },
      );
    }

    // If a requestId was provided, save the results to the database
    if (requestId && result.routes.length > 0) {
      const db = getDb();

      // Verify the transport request belongs to this tenant before modifying routes
      const [transportReq] = await db
        .select({ id: transportRequests.id })
        .from(transportRequests)
        .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, session.tenantId)))
        .limit(1);

      if (!transportReq) {
        return NextResponse.json({ error: 'Transport request not found or access denied' }, { status: 404 });
      }

      // Remove old routes for this request (so we can replace them)
      await db.delete(requestRoutes).where(eq(requestRoutes.requestId, requestId));

      // Insert the calculated routes
      await db.insert(requestRoutes).values(
        result.routes.map((r) => ({
          requestId,
          originName: r.originName,
          destinationName: r.destinationName,
          originPlaceId: r.originPlaceId,
          destinationPlaceId: r.destinationPlaceId,
          originCoordinates: { lat: r.originLat, lng: r.originLng },
          destinationCoordinates: { lat: r.destLat, lng: r.destLng },
          mappedDistanceKm: r.distanceKm,
          mappedDurationMinutes: r.durationMinutes,
          routePolyline: r.routePolyline,
          totalKilometres: r.distanceKm,
          additionalKilometres: 0,
          isVerified: false,
          calculationTimestamp: new Date(),
        })),
      );
    }

    return NextResponse.json({
      configured: true,
      ...result,
    });
  } catch (error) {
    console.error('[routes/calculate] Failed:', error);
    return NextResponse.json(
      { error: 'Route calculation failed: ' + String(error) },
      { status: 500 },
    );
  }
}
