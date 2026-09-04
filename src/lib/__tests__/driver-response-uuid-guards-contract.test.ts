import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const declineRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/decline/route.ts'),
  'utf8',
);
const acknowledgeRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/acknowledge/route.ts'),
  'utf8',
);

describe('driver response UUID guards', () => {
  it('keeps decline auth and reason validation ahead of the malformed-id guard', () => {
    const actionIndex = declineRoute.indexOf("requireDashboardAction(session, '/dashboard/driver-mobile', 'update')");
    const reasonIndex = declineRoute.indexOf('if (reason.length > 500)');
    const guardIndex = declineRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = declineRoute.indexOf('const db = getDb()');

    expect(declineRoute).toContain('const UUID_PATTERN =');
    expect(declineRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(actionIndex).toBeGreaterThan(-1);
    expect(reasonIndex).toBeGreaterThan(actionIndex);
    expect(guardIndex).toBeGreaterThan(reasonIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps decline atomic claims and conflict recovery behind the guard', () => {
    const guardIndex = declineRoute.indexOf('if (!UUID_PATTERN.test(id))');
    expect(declineRoute).toContain('${id}::uuid');
    expect(declineRoute.indexOf('${id}::uuid')).toBeGreaterThan(guardIndex);
    expect(declineRoute).toContain("String(error).includes('atomic_driver_decline_failed')");
    expect(declineRoute).toContain('{ status: 409 }');
  });

  it('keeps acknowledgement confirmations and coordinate validation ahead of the malformed-id guard', () => {
    const actionIndex = acknowledgeRoute.indexOf("requireDashboardAction(session, '/dashboard/driver-mobile', 'update')");
    const confirmationsIndex = acknowledgeRoute.indexOf('if (confirmations.some((confirmed) => confirmed !== true))');
    const longitudeIndex = acknowledgeRoute.indexOf("return NextResponse.json({ error: 'Longitude is invalid' }");
    const guardIndex = acknowledgeRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = acknowledgeRoute.indexOf('const db = getDb()');

    expect(acknowledgeRoute).toContain('const UUID_PATTERN =');
    expect(acknowledgeRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(actionIndex).toBeGreaterThan(-1);
    expect(confirmationsIndex).toBeGreaterThan(actionIndex);
    expect(longitudeIndex).toBeGreaterThan(confirmationsIndex);
    expect(guardIndex).toBeGreaterThan(longitudeIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps the durable acknowledgement transition behind the guard', () => {
    const guardIndex = acknowledgeRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const transitionIndex = acknowledgeRoute.indexOf('const result = await processDriverAcknowledgement');
    expect(transitionIndex).toBeGreaterThan(guardIndex);
  });
});
