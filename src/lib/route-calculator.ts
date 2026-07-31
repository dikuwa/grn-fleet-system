/**
 * Route Calculator
 *
 * Calculates driving distances, durations, and route polylines between
 * origin and destination locations using the Google Maps **Routes API**
 * (computeRoutes) — the modern replacement for the legacy Distance Matrix,
 * Geocoding and Directions JSON APIs.
 *
 * Key behaviour:
 *  - Sends the application origin as the `Referer` header. Server API keys are
 *    often configured with HTTP-referrer restrictions; without a matching
 *    referer Google rejects the call with API_KEY_HTTP_REFERRER_BLOCKED.
 *  - Returns structured errors (NOT_CONFIGURED, REFERER_BLOCKED,
 *    API_NOT_ENABLED, NO_ROUTE, RATE_LIMITED) so the API layer can surface
 *    actionable messages instead of a generic failure.
 *  - Falls back to a straight-line (haversine) distance estimate when Google
 *    is unreachable, so the app degrades gracefully rather than returning
 *    nothing. This fallback uses the Geocoding API (legacy JSON endpoint),
 *    which must therefore remain enabled alongside the Routes API.
 */

import { env, hasEnvVar } from '@/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RouteProvider = 'google_routes' | 'haversine';

export type RouteResult = {
  originName: string;
  destinationName: string;
  distanceKm: number;
  durationMinutes: number;
  routePolyline: string;
  originPlaceId: string;
  destinationPlaceId: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  provider: RouteProvider;
};

export type MultiRouteResult = {
  routes: RouteResult[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
};

export type RouteErrorCode =
  | 'NOT_CONFIGURED'
  | 'REFERER_BLOCKED'
  | 'API_NOT_ENABLED'
  | 'KEY_INVALID'
  | 'NO_ROUTE'
  | 'GEOCODE_FAILED'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export type RouteError = {
  code: RouteErrorCode;
  message: string;
  /** The raw message returned by Google, when available. */
  googleMessage?: string;
};

export type RouteCalculationOutcome =
  | { ok: true; route: RouteResult }
  | { ok: false; error: RouteError };

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the Google Maps Routes API is configured.
 */
export function isRouteCalculatorConfigured(): boolean {
  return hasEnvVar('GOOGLE_MAPS_SERVER_API_KEY');
}

/**
 * The origin the app runs at — used as the `Referer` on server-side Google
 * calls so that referer-restricted API keys are accepted.
 */
function getRefererOrigin(): string {
  try {
    return new URL(env.NEXT_PUBLIC_APP_URL).origin;
  } catch {
    return env.NEXT_PUBLIC_APP_URL;
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapGoogleFailure(res: Response, body: { error?: { message?: string; details?: Array<{ reason?: string }> } }): RouteError {
  const googleMessage = body?.error?.message;
  const reason = body?.error?.details?.[0]?.reason;
  const status = res.status;

  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: 'Google Maps rate limit exceeded. Try again shortly or raise the quota in Google Cloud Console.',
      googleMessage,
    };
  }

  if (reason === 'API_KEY_HTTP_REFERRER_BLOCKED' || /referer/i.test(googleMessage || '')) {
    return {
      code: 'REFERER_BLOCKED',
      message:
        'The Google Maps server key is restricted to specific website referers, which blocks server-side route requests. ' +
        'In Google Cloud Console → APIs & Services → Credentials, edit the key used by GOOGLE_MAPS_SERVER_API_KEY and ' +
        'switch "Application restrictions" to IP addresses (recommended for servers), or add this app’s origin to the ' +
        'allowed websites.',
      googleMessage,
    };
  }

  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_SERVICE_BLOCKED') {
    return {
      code: 'KEY_INVALID',
      message:
        'The Google Maps API key is invalid or the key is blocked for this service. Check GOOGLE_MAPS_SERVER_API_KEY ' +
        'and confirm the Routes API is enabled for your project.',
      googleMessage,
    };
  }

  if (reason === 'ACCESS_NOT_CONFIGURED' || reason === 'SERVICE_DISABLED' || /not enabled|not activated|legacy/i.test(googleMessage || '')) {
    return {
      code: 'API_NOT_ENABLED',
      message:
        'The Google Maps Routes API is not enabled for this project. In Google Cloud Console → APIs & Services, ' +
        'enable "Routes API" (and "Geocoding API" for address lookups) for the project linked to GOOGLE_MAPS_SERVER_API_KEY.',
      googleMessage,
    };
  }

  return {
    code: 'UNKNOWN',
    message: `Google Maps request failed (HTTP ${status}). ${googleMessage || ''}`.trim(),
    googleMessage,
  };
}

// ---------------------------------------------------------------------------
// Google Routes API (primary)
// ---------------------------------------------------------------------------

/**
 * Call the modern Routes API. A single call resolves both addresses and
 * returns distance, duration, polyline, coordinates and place IDs.
 */
async function computeRoutes(
  origin: string,
  destination: string,
  apiKey: string,
  referer: string,
): Promise<{ route?: RouteResult; error?: RouteError }> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation,geocodingResults',
      Referer: referer,
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      travelMode: 'DRIVE',
      units: 'METRIC',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { error: mapGoogleFailure(res, body) };
  }

  const route = body?.routes?.[0];
  if (!route || typeof route.distanceMeters !== 'number') {
    return {
      error: {
        code: 'NO_ROUTE',
        message: 'No driving route could be found between those locations. Check the place names and try again.',
      },
    };
  }

  // duration is a string like "25721s"
  const durationSeconds = parseFloat(String(route.duration || '0')) || 0;

  const legs: Array<{ startLocation?: { latLng?: { latitude: number; longitude: number } }; endLocation?: { latLng?: { latitude: number; longitude: number } } }> =
    route.legs || [];
  const start = legs[0]?.startLocation?.latLng;
  const end = legs[legs.length - 1]?.endLocation?.latLng;
  const geo = body?.geocodingResults as
    | { origin?: { placeId?: string }; destination?: { placeId?: string } }
    | undefined;

  return {
    route: {
      originName: origin,
      destinationName: destination,
      distanceKm: Math.round(route.distanceMeters / 1000),
      durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
      routePolyline: route.polyline?.encodedPolyline || '',
      originPlaceId: geo?.origin?.placeId || '',
      destinationPlaceId: geo?.destination?.placeId || '',
      originLat: start?.latitude ?? 0,
      originLng: start?.longitude ?? 0,
      destLat: end?.latitude ?? 0,
      destLng: end?.longitude ?? 0,
      provider: 'google_routes',
    },
  };
}

// ---------------------------------------------------------------------------
// Geocoding (best-effort, used by the haversine fallback)
// ---------------------------------------------------------------------------

async function geocode(
  address: string,
  apiKey: string,
  referer: string,
): Promise<{ lat: number; lng: number; placeId: string } | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), {
    headers: { Referer: referer },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (data?.status !== 'OK' || !data.results?.[0]) return null;

  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    placeId: result.place_id,
  };
}

// ---------------------------------------------------------------------------
// Haversine fallback
// ---------------------------------------------------------------------------

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Straight-line estimate at ~70 km/h average. Only used when Google is down. */
async function haversineFallback(
  origin: string,
  destination: string,
  apiKey: string,
  referer: string,
): Promise<RouteResult | null> {
  try {
    const [originGeo, destGeo] = await Promise.all([geocode(origin, apiKey, referer), geocode(destination, apiKey, referer)]);
    if (!originGeo || !destGeo) return null;

    const distanceKm = Math.max(1, Math.round(haversineKm(originGeo.lat, originGeo.lng, destGeo.lat, destGeo.lng)));
    return {
      originName: origin,
      destinationName: destination,
      distanceKm,
      durationMinutes: Math.max(1, Math.round((distanceKm / 70) * 60)),
      routePolyline: '',
      originPlaceId: originGeo.placeId,
      destinationPlaceId: destGeo.placeId,
      originLat: originGeo.lat,
      originLng: originGeo.lng,
      destLat: destGeo.lat,
      destLng: destGeo.lng,
      provider: 'haversine',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate distance and duration between origin and destination using the
 * Google Routes API, with a haversine fallback when Google is unreachable.
 *
 * @returns Detailed outcome including structured errors for actionable messaging.
 */
export async function calculateRouteDetailed(
  origin: string,
  destination: string,
): Promise<RouteCalculationOutcome> {
  const apiKey = env.GOOGLE_MAPS_SERVER_API_KEY;
  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (!apiKey || !appUrl) {
    return {
      ok: false,
      error: {
        code: 'NOT_CONFIGURED',
        message:
          'Route calculation is not configured. Set GOOGLE_MAPS_SERVER_API_KEY and NEXT_PUBLIC_APP_URL in your environment ' +
          '(the server key is referer-restricted, so the app origin is sent as the Referer header).',
      },
    };
  }

  const referer = getRefererOrigin();

  try {
    const primary = await computeRoutes(origin, destination, apiKey, referer);
    if (primary.route) return { ok: true, route: primary.route };

    // Transient / no-route failures degrade to a straight-line estimate when
    // Google is reachable enough to geocode. Config errors (referer/API not
    // enabled) propagate so the user can fix them.
    if (primary.error?.code === 'NO_ROUTE' || primary.error?.code === 'UNKNOWN' || primary.error?.code === 'RATE_LIMITED') {
      const fallback = await haversineFallback(origin, destination, apiKey, referer);
      if (fallback) return { ok: true, route: fallback };
    }

    return {
      ok: false,
      error: primary.error ?? {
        code: 'UNKNOWN',
        message: 'Route calculation failed. Check the location names and try again.',
      },
    };
  } catch (error) {
    // Network failure — attempt haversine fallback before giving up.
    console.error('[RouteCalculator] Failed to calculate route:', error);
    const fallback = await haversineFallback(origin, destination, apiKey, referer);
    if (fallback) return { ok: true, route: fallback };

    return {
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Route calculation failed because Google Maps is unreachable. Check the server key configuration and network access.',
        googleMessage: String(error),
      },
    };
  }
}

/**
 * Calculate distance and duration between origin and destination.
 *
 * @returns RouteResult or null if the calculation fails.
 */
export async function calculateRoute(origin: string, destination: string): Promise<RouteResult | null> {
  const outcome = await calculateRouteDetailed(origin, destination);
  return outcome.ok ? outcome.route : null;
}

/**
 * Calculate routes for a list of origin-destination pairs.
 * Results are aggregated into a single MultiRouteResult.
 */
export async function calculateMultiRoute(
  legs: Array<{ origin: string; destination: string }>,
): Promise<MultiRouteResult | null> {
  if (legs.length === 0) return null;

  const outcomes = await Promise.all(legs.map((leg) => calculateRouteDetailed(leg.origin, leg.destination)));
  const successful = outcomes
    .filter((o): o is { ok: true; route: RouteResult } => o.ok)
    .map((o) => o.route);

  if (successful.length === 0) return null;

  return {
    routes: successful,
    totalDistanceKm: successful.reduce((sum, r) => sum + r.distanceKm, 0),
    totalDurationMinutes: successful.reduce((sum, r) => sum + r.durationMinutes, 0),
  };
}
