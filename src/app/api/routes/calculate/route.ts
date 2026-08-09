import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  calculateRouteDetailed,
  calculateMultiRoute,
  isRouteCalculatorConfigured,
  type MultiRouteResult,
} from '@/lib/route-calculator';
import { getDb } from '@/db';
import { requestRoutes, transportRequests } from '@/db/schema/requests';
import { rateLimit } from '@/lib/rate-limit';
import { eq, and, or, inArray } from 'drizzle-orm';
import { runAtomicMutations } from '@/lib/db-atomic';

// Upper bound on legs per request — each leg is a paid Google API call.
const MAX_LEGS = 10;
const ROUTE_EDITABLE_STATUSES = ['draft', 'returned', 'rejected', 'supervisor_rejected'] as const;

/**
 * POST /api/routes/calculate
 *
 * Calculate a route (or multi-leg route) using the Google Maps Routes API.
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

    // Check if route calculator is configured (fail fast before rate limiting,
    // so a misconfigured deployment never burns user quota on 503s)
    if (!isRouteCalculatorConfigured()) {
      return NextResponse.json(
        {
          error:
            'Route calculation is not configured. Set GOOGLE_MAPS_SERVER_API_KEY in your environment and enable the Google Maps Routes API.',
          configured: false,
        },
        { status: 503 },
      );
    }

    // Rate limit paid Google API usage per session
    const rl = await rateLimit(`routes:${session.user.id}`, 30, 60);
    if (!rl.success) {
      return NextResponse.json(
        { error: 'Too many route calculations. Try again shortly.', configured: true },
        { status: 429, headers: rl.headers },
      );
    }

    const body = await req.json();
    const { origin, destination, legs, requestId } = body;

    // Validate the shape of each leg before any paid call is made.
    if (legs !== undefined && !Array.isArray(legs)) {
      return NextResponse.json({ error: 'legs must be an array.', configured: true }, { status: 400 });
    }
    if (legs && legs.some((leg: { origin?: unknown; destination?: unknown }) => !leg || typeof leg.origin !== 'string' || typeof leg.destination !== 'string')) {
      return NextResponse.json(
        { error: 'Each leg must have string origin and destination values.', configured: true },
        { status: 400 },
      );
    }

    let result: MultiRouteResult | null = null;
    let routeError: { code: string; message: string; googleMessage?: string } | null = null;

    if (legs && Array.isArray(legs) && legs.length > 0) {
      if (legs.length > MAX_LEGS) {
        return NextResponse.json(
          { error: `Too many route legs. Maximum is ${MAX_LEGS}.`, configured: true },
          { status: 400 },
        );
      }
      // Multi-leg calculation
      const multi = await calculateMultiRoute(legs);
      result = multi;
    } else if (origin && destination) {
      // Single route calculation
      const outcome = await calculateRouteDetailed(origin, destination);
      if (outcome.ok) {
        const r = outcome.route;
        result = {
          routes: [r],
          totalDistanceKm: r.distanceKm,
          totalDurationMinutes: r.durationMinutes,
        };
      } else {
        routeError = outcome.error;
      }
    } else {
      return NextResponse.json(
        { error: 'Provide either origin+destination, or legs array.' },
        { status: 400 },
      );
    }

    if (!result) {
      if (routeError) {
        // Surface the actionable Google error with an appropriate status
        const status =
          routeError.code === 'REFERER_BLOCKED' || routeError.code === 'API_NOT_ENABLED' || routeError.code === 'KEY_INVALID'
            ? 502
            : routeError.code === 'RATE_LIMITED'
              ? 429
              : 422;
        // Never echo raw Google/internal error strings for UNKNOWN failures —
        // those may contain environment or network internals. Keep the
        // actionable codes (REFERER_BLOCKED, API_NOT_ENABLED, …) surfaced.
        const includeGoogleMessage = routeError.code !== 'UNKNOWN';
        return NextResponse.json(
          {
            error: routeError.message,
            code: routeError.code,
            googleMessage: includeGoogleMessage ? routeError.googleMessage : undefined,
            configured: true,
          },
          { status },
        );
      }
      return NextResponse.json(
        { error: 'Could not calculate the route. Check location names and try again.', configured: true },
        { status: 422 },
      );
    }

    // If a requestId was provided, save the results to the database. Persisted
    // route edits are requester-owned mutations, not tenant-wide REQUEST_VIEW
    // operations: a passenger or unrelated tenant user must never be able to
    // replace another requester's itinerary by guessing an ID.
    if (requestId && result.routes.length > 0) {
      const db = getDb();

      const [transportReq] = await db
        .select({ id: transportRequests.id, status: transportRequests.status })
        .from(transportRequests)
        .where(
          and(
            eq(transportRequests.id, requestId),
            eq(transportRequests.tenantId, session.tenantId),
            or(
              eq(transportRequests.requesterUserId, session.user.id),
              eq(transportRequests.enteredByUserId, session.user.id),
            )!,
            inArray(transportRequests.status, [...ROUTE_EDITABLE_STATUSES]),
          ),
        )
        .limit(1);

      if (!transportReq) {
        return NextResponse.json(
          { error: 'Transport request is not editable by this user.' },
          { status: 404 },
        );
      }

      // Replace the route set as one transaction so a failed insert cannot
      // leave an otherwise valid editable request with its itinerary erased.
      await runAtomicMutations((tx) => [
        tx.delete(requestRoutes).where(eq(requestRoutes.requestId, requestId)),
        tx.insert(requestRoutes).values(
          result.routes.map((r) => ({
            requestId,
            originName: r.originName as string,
            destinationName: r.destinationName as string,
            originPlaceId: (r.originPlaceId as string) || null,
            destinationPlaceId: (r.destinationPlaceId as string) || null,
            originCoordinates: { lat: r.originLat as number, lng: r.originLng as number },
            destinationCoordinates: { lat: r.destLat as number, lng: r.destLng as number },
            mappedDistanceKm: r.distanceKm,
            mappedDurationMinutes: r.durationMinutes,
            routePolyline: (r.routePolyline as string) || null,
            totalKilometres: r.distanceKm,
            additionalKilometres: 0,
            isVerified: false,
            calculationTimestamp: new Date(),
          })),
        ),
      ]);
    }

    return NextResponse.json({
      configured: true,
      ...result,
    });
  } catch (error) {
    // Log full details server-side but never echo internals to the client.
    console.error('[routes/calculate] Failed:', error);
    return NextResponse.json(
      {
        error: 'Route calculation failed. Please try again or check the Google Maps configuration.',
        configured: isRouteCalculatorConfigured(),
      },
      { status: 500 },
    );
  }
}
