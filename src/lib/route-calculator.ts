/**
 * Route Calculator
 *
 * Wraps the Google Maps Distance Matrix API to calculate driving distances,
 * durations, and route polylines between origin and destination locations.
 *
 * Falls back gracefully when no API key is configured — returns null
 * so callers can fall back to manual distance entry.
 */

import { env, hasEnvVar } from '@/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
};

export type MultiRouteResult = {
  routes: RouteResult[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
};

// ---------------------------------------------------------------------------
// Google Maps helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the Google Maps Distance Matrix API is configured.
 */
export function isRouteCalculatorConfigured(): boolean {
  return hasEnvVar('GOOGLE_MAPS_SERVER_API_KEY');
}

/**
 * Geocode a place name to coordinates + place ID using the Google Geocoding API.
 */
async function geocode(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lng: number; placeId: string } | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.[0]) return null;

  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    placeId: result.place_id,
  };
}

/**
 * Calculate distance and duration between origin and destination using the
 * Google Maps Distance Matrix API.
 *
 * @param origin  - Text description of the origin (e.g. "Rundu, Namibia")
 * @param destination - Text description of the destination
 * @returns RouteResult or null if the API call fails or is not configured
 */
export async function calculateRoute(
  origin: string,
  destination: string,
): Promise<RouteResult | null> {
  const apiKey = env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) return null;

  try {
    // Geocode both locations to get place IDs and coordinates
    const [originGeo, destGeo] = await Promise.all([
      geocode(origin, apiKey),
      geocode(destination, apiKey),
    ]);

    if (!originGeo || !destGeo) return null;

    // Call the Distance Matrix API
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', `place_id:${originGeo.placeId}`);
    url.searchParams.set('destinations', `place_id:${destGeo.placeId}`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('units', 'metric');

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== 'OK') return null;

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;

    const distanceKm = Math.round(element.distance.value / 1000);
    const durationMinutes = Math.round(element.duration.value / 60);

    // Get the route polyline using Directions API for a more accurate trace
    let routePolyline = '';
    try {
      const dirUrl = new URL('https://maps.googleapis.com/maps/api/directions/json');
      dirUrl.searchParams.set('origin', `place_id:${originGeo.placeId}`);
      dirUrl.searchParams.set('destination', `place_id:${destGeo.placeId}`);
      dirUrl.searchParams.set('key', apiKey);

      const dirRes = await fetch(dirUrl.toString());
      if (dirRes.ok) {
        const dirData = await dirRes.json();
        if (dirData.routes?.[0]?.overview_polyline?.points) {
          routePolyline = dirData.routes[0].overview_polyline.points;
        }
      }
    } catch {
      // Polyline is optional — non-blocking
    }

    return {
      originName: origin,
      destinationName: destination,
      distanceKm,
      durationMinutes,
      routePolyline,
      originPlaceId: originGeo.placeId,
      destinationPlaceId: destGeo.placeId,
      originLat: originGeo.lat,
      originLng: originGeo.lng,
      destLat: destGeo.lat,
      destLng: destGeo.lng,
    };
  } catch (error) {
    console.error('[RouteCalculator] Failed to calculate route:', error);
    return null;
  }
}

/**
 * Calculate routes for a list of origin-destination pairs.
 * Results are aggregated into a single MultiRouteResult.
 */
export async function calculateMultiRoute(
  legs: Array<{ origin: string; destination: string }>,
): Promise<MultiRouteResult | null> {
  if (legs.length === 0) return null;

  const results = await Promise.all(
    legs.map((leg) => calculateRoute(leg.origin, leg.destination)),
  );

  const successful = results.filter((r): r is RouteResult => r !== null);
  if (successful.length === 0) return null;

  return {
    routes: successful,
    totalDistanceKm: successful.reduce((sum, r) => sum + r.distanceKm, 0),
    totalDurationMinutes: successful.reduce((sum, r) => sum + r.durationMinutes, 0),
  };
}
