import { describe, expect, it } from 'vitest';
import {
  isRouteReadyForAutomaticCalculation,
  routeCalculationIdentity,
} from './responsive-routing';

describe('responsive transport route automation', () => {
  it('triggers only after both places have stable selections', () => {
    expect(
      isRouteReadyForAutomaticCalculation({
        originName: 'Rundu',
        destinationName: 'Windhoek',
        originPlaceId: 'origin-id',
        destinationPlaceId: 'destination-id',
      }),
    ).toBe(true);
    expect(
      isRouteReadyForAutomaticCalculation({
        originName: 'Rundu',
        destinationName: 'Windhoek',
        originPlaceId: 'origin-id',
      }),
    ).toBe(false);
  });

  it('changes identity when either selected place changes', () => {
    const first = routeCalculationIdentity([
      { id: 'route-1', originPlaceId: 'a', destinationPlaceId: 'b' },
    ]);
    const second = routeCalculationIdentity([
      { id: 'route-1', originPlaceId: 'a', destinationPlaceId: 'c' },
    ]);
    expect(first).not.toBe(second);
  });
});
