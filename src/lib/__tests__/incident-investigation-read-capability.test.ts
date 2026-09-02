import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/investigation/route.ts'),
  'utf8',
);

describe('incident investigation read capability contract', () => {
  it('allows either investigation editors or authorised closers to read evidence', () => {
    expect(routeSource).toContain('requireAnyPermission(session, [');
    expect(routeSource).toContain('Permissions.INCIDENT_INVESTIGATE,');
    expect(routeSource).toContain('Permissions.INCIDENT_CLOSE_INVESTIGATION,');
    expect(routeSource).toContain('if (readPermission instanceof NextResponse) return readPermission;');
  });

  it('does not regress GET back to an investigate-only permission gate', () => {
    const getSection = routeSource.split('export async function PATCH', 1)[0];
    expect(getSection).toContain('requireAnyPermission(session, [');
    expect(getSection).not.toContain(
      'requirePermission(\n      session,\n      Permissions.INCIDENT_INVESTIGATE,\n    )',
    );
  });

  it('keeps the close capability independently resolved and PATCH mutations permission-specific', () => {
    expect(routeSource).toContain('const closePermission = await requirePermission(');
    expect(routeSource).toContain('const canCloseInvestigation = !(closePermission instanceof NextResponse);');
    expect(routeSource).toContain("isClosing ? Permissions.INCIDENT_CLOSE_INVESTIGATION : Permissions.INCIDENT_INVESTIGATE");
  });

  it('does not broaden tenant data lookup', () => {
    expect(routeSource).toContain('getTenantIncident(session.tenantId, id)');
  });
});
