'use client';

import dynamic from 'next/dynamic';

const RouteMapInner = dynamic(() => import('@/components/map/request-route-map'), {
  ssr: false,
});

interface RouteData {
  id: string;
  originName: string | null;
  destinationName: string | null;
  originCoordinates: { lat: number; lng: number } | null;
  destinationCoordinates: { lat: number; lng: number } | null;
  routePolyline: string | null;
  mappedDistanceKm: number | null;
  mappedDurationMinutes: number | null;
  totalKilometres: number;
}

interface RouteMapWrapperProps {
  routes: RouteData[];
}

export function RouteMapWrapper({ routes }: RouteMapWrapperProps) {
  return <RouteMapInner routes={routes} />;
}
