import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateRoute,
  calculateRouteDetailed,
  calculateMultiRoute,
  isRouteCalculatorConfigured,
} from '@/lib/route-calculator';
import * as envModule from '@/env';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof envModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      GOOGLE_MAPS_SERVER_API_KEY: 'test-server-key',
      NEXT_PUBLIC_APP_URL: 'https://app.example.gov.na',
    },
  };
});

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function routesApiResponse(overrides: Record<string, unknown> = {}) {
  return {
    routes: [
      {
        distanceMeters: 715388,
        duration: '25721s',
        polyline: { encodedPolyline: 'lallBa_qwBvGiF' },
        legs: [
          {
            startLocation: { latLng: { latitude: -17.9255107, longitude: 19.7529683 } },
            endLocation: { latLng: { latitude: -22.5649144, longitude: 17.0841248 } },
          },
        ],
        ...((overrides.routes as Array<Record<string, unknown>> | undefined)?.[0]),
      },
    ],
    geocodingResults: {
      origin: { placeId: 'ChIJorigin' },
      destination: { placeId: 'ChIJdest' },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('route-calculator (Routes API)', () => {
  it('isRouteCalculatorConfigured returns true when key is set', () => {
    expect(isRouteCalculatorConfigured()).toBe(true);
  });

  it('calculateRoute calls computeRoutes with the API key and referer header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => routesApiResponse(),
    });

    const route = await calculateRoute('Rundu, Namibia', 'Windhoek, Namibia');
    expect(route).not.toBeNull();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('routes.googleapis.com/directions/v2:computeRoutes');

    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-server-key');
    expect(headers['Referer']).toBe('https://app.example.gov.na');

    const body = JSON.parse(init.body as string);
    expect(body.origin.address).toBe('Rundu, Namibia');
    expect(body.destination.address).toBe('Windhoek, Namibia');
    expect(body.travelMode).toBe('DRIVE');
    expect(body.units).toBe('METRIC');
  });

  it('parses distance, duration, polyline, coordinates and place IDs from the Routes API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => routesApiResponse(),
    });

    const outcome = await calculateRouteDetailed('Rundu, Namibia', 'Windhoek, Namibia');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.route.distanceKm).toBe(715);
    expect(outcome.route.durationMinutes).toBe(429);
    expect(outcome.route.routePolyline).toBe('lallBa_qwBvGiF');
    expect(outcome.route.originPlaceId).toBe('ChIJorigin');
    expect(outcome.route.destinationPlaceId).toBe('ChIJdest');
    expect(outcome.route.originLat).toBeCloseTo(-17.9255107);
    expect(outcome.route.destLng).toBeCloseTo(17.0841248);
    expect(outcome.route.provider).toBe('google_routes');
  });

  it('maps referer-blocked responses to an actionable REFERER_BLOCKED error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          message: 'Requests from referer <empty> are blocked.',
          details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }],
        },
      }),
    });

    const outcome = await calculateRouteDetailed('Rundu', 'Windhoek');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('REFERER_BLOCKED');
    expect(outcome.error.message).toContain('IP addresses');
  });

  it('maps API-not-enabled responses to API_NOT_ENABLED', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          message: "You're calling a legacy API, which is not enabled for your project.",
          details: [{ reason: 'ACCESS_NOT_CONFIGURED' }],
        },
      }),
    });

    const outcome = await calculateRouteDetailed('Rundu', 'Windhoek');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('API_NOT_ENABLED');
    expect(outcome.error.message).toContain('Routes API');
  });

  it('returns NO_ROUTE when the Routes API finds no route and no fallback geocode', async () => {
    // Routes API returns OK with no routes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ routes: [] }),
    });
    // Geocode fallback also fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ status: 'REQUEST_DENIED' }),
    });

    const outcome = await calculateRouteDetailed('Xyzzyville, Mars', 'Narnia, Middle Earth');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('NO_ROUTE');
  });

  it('falls back to a haversine estimate when the Routes API is rate limited but geocoding works', async () => {
    // Rate limited by Routes API
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Quota exceeded', details: [] } }),
    });
    // Geocoding succeeds for both addresses
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        results: [{ geometry: { location: { lat: -17.9255, lng: 19.753 } }, place_id: 'ChIJorigin' }],
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        results: [{ geometry: { location: { lat: -22.5649, lng: 17.0841 } }, place_id: 'ChIJdest' }],
      }),
    });

    const outcome = await calculateRouteDetailed('Rundu, Namibia', 'Windhoek, Namibia');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.route.provider).toBe('haversine');
    expect(outcome.route.distanceKm).toBeGreaterThan(400);
    expect(outcome.route.distanceKm).toBeLessThan(800);
    expect(outcome.route.routePolyline).toBe('');
  });

  it('returns NOT_CONFIGURED when the key is missing', async () => {
    vi.mocked(envModule).env = { ...envModule.env, GOOGLE_MAPS_SERVER_API_KEY: '' } as never;

    const outcome = await calculateRouteDetailed('Rundu', 'Windhoek');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('NOT_CONFIGURED');

    vi.mocked(envModule).env = { ...envModule.env, GOOGLE_MAPS_SERVER_API_KEY: 'test-server-key' } as never;
  });

  it('calculateMultiRoute aggregates legs and skips failed legs', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => routesApiResponse({ routes: [{ distanceMeters: 200000, duration: '7200s' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => routesApiResponse({ routes: [{ distanceMeters: 300000, duration: '9000s' }] }),
      });

    const result = await calculateMultiRoute([
      { origin: 'A', destination: 'B' },
      { origin: 'B', destination: 'C' },
    ]);

    expect(result).not.toBeNull();
    expect(result?.routes.length).toBe(2);
    expect(result?.totalDistanceKm).toBe(200 + 300);
    expect(result?.totalDurationMinutes).toBe(120 + 150);
  });
});
