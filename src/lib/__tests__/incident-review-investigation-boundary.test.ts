import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reviewRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);
const reviewPage = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/trips/incidents/[id]/page.tsx'),
  'utf8',
);

describe('incident review investigation permission and closure boundary', () => {
  it('requires the dedicated investigate capability in both API and UI', () => {
    expect(reviewRoute).toContain(': [Permissions.INCIDENT_INVESTIGATE];');
    expect(reviewRoute).not.toContain(
      ': [Permissions.INCIDENT_INVESTIGATE, Permissions.TRIP_INCIDENT_MANAGE];',
    );
    expect(reviewPage).toContain(
      'const canInvestigate = permissions.includes(Permissions.INCIDENT_INVESTIGATE);',
    );
    expect(reviewPage).not.toContain(
      'permissions.includes(Permissions.INCIDENT_INVESTIGATE) || permissions.includes(Permissions.TRIP_INCIDENT_MANAGE)',
    );
  });

  it('delegates final closure to the canonical investigation service and requires findings', () => {
    const closeStart = reviewRoute.indexOf("if (action === 'close_investigation')");
    const nextAction = reviewRoute.indexOf("if (action === 'return_vehicle_to_service')", closeStart);
    const closeBlock = reviewRoute.slice(closeStart, nextAction);

    expect(closeStart).toBeGreaterThan(-1);
    expect(nextAction).toBeGreaterThan(closeStart);
    expect(reviewRoute).toContain("import { updateInvestigation } from '@/lib/incidents/mva';");
    expect(closeBlock).toContain('Investigation notes are required before closing.');
    expect(closeBlock).toContain('const result = await updateInvestigation(');
    expect(closeBlock).toContain("{ status: 'closed', notes }");
    expect(closeBlock).not.toContain('WITH incident_claim AS');
  });

  it('preserves operational document refresh after insurance and technical updates', () => {
    const insuranceStart = reviewRoute.indexOf("if (action === 'insurance_update')");
    const technicalStart = reviewRoute.indexOf("if (action === 'technical_clearance')");
    const closeStart = reviewRoute.indexOf("if (action === 'close_investigation')");

    const insuranceBlock = reviewRoute.slice(insuranceStart, technicalStart);
    const technicalBlock = reviewRoute.slice(technicalStart, closeStart);

    expect(insuranceBlock).toContain('await refreshIncidentOperationalDocuments({');
    expect(technicalBlock).toContain('await refreshIncidentOperationalDocuments({');
  });
});
