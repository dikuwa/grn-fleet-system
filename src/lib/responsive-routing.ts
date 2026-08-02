export type AutomaticRouteCandidate = {
  originName?: string | null;
  destinationName?: string | null;
  originPlaceId?: string | null;
  destinationPlaceId?: string | null;
};

export function isRouteReadyForAutomaticCalculation(route: AutomaticRouteCandidate) {
  return Boolean(
    route.originName?.trim() &&
    route.destinationName?.trim() &&
    route.originPlaceId &&
    route.destinationPlaceId,
  );
}

export function routeCalculationIdentity(
  routes: readonly (AutomaticRouteCandidate & { id: string })[],
) {
  return routes
    .map((route) => `${route.id}:${route.originPlaceId ?? ''}:${route.destinationPlaceId ?? ''}`)
    .join('|');
}
