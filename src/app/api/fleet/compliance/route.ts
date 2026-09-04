import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles, vehicleDocuments } from '@/db/schema/fleet';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, sql } from 'drizzle-orm';

/**
 * GET /api/fleet/compliance
 * Returns vehicles with compliance status, expiry tracking, and upcoming items.
 * Access is intentionally limited to workspaces registered for the Compliance
 * Reports route; VEHICLE_VIEW alone must not widen an assigned/related workspace
 * into a tenant-wide compliance feed.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/fleet/compliance', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Get all vehicles for this tenant with expiry data. This endpoint is
    // tenant-wide by design, but only for the explicitly tenant-wide Compliance
    // Reports workspaces guarded above.
    const vehicleRows = await db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        make: vehicles.make,
        model: vehicles.model,
        status: vehicles.status,
        roadworthyTestDate: vehicles.roadworthyTestDate,
        licenceExpiryDate: vehicles.licenceExpiryDate,
        currentOdometer: vehicles.currentOdometer,
      })
      .from(vehicles)
      .where(eq(vehicles.tenantId, session.tenantId))
      .orderBy(vehicles.licenceNumber);

    // Get all vehicle documents with expiry dates for this tenant's vehicles.
    // Retained historical records are evidence, but only a verified current
    // policy may satisfy insurance compliance.
    const documentRows = await db
      .select({
        id: vehicleDocuments.id,
        vehicleId: vehicleDocuments.vehicleId,
        documentType: vehicleDocuments.documentType,
        documentName: vehicleDocuments.documentName,
        referenceNumber: vehicleDocuments.referenceNumber,
        issueDate: vehicleDocuments.issueDate,
        expiryDate: vehicleDocuments.expiryDate,
        isVerified: vehicleDocuments.isVerified,
        createdAt: vehicleDocuments.createdAt,
      })
      .from(vehicleDocuments)
      .where(
        sql`${vehicleDocuments.vehicleId} IN (SELECT id FROM vehicles WHERE tenant_id = ${session.tenantId})`,
      );

    // Compile compliance status for each vehicle.
    const today = new Date();

    const complianceData = vehicleRows.map((v) => {
      const docItems = documentRows.filter((d) => d.vehicleId === v.id);
      const items: Array<{
        type: string;
        name: string;
        expiryDate: string | null;
        status: 'valid' | 'expiring_soon' | 'expired' | 'unknown';
        daysRemaining: number | null;
      }> = [];

      // Licence expiry.
      if (v.licenceExpiryDate) {
        const expiry = new Date(v.licenceExpiryDate);
        const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        items.push({
          type: 'licence',
          name: 'Vehicle Licence',
          expiryDate: v.licenceExpiryDate,
          status: days < 0 ? 'expired' : days <= 30 ? 'expiring_soon' : 'valid',
          daysRemaining: days,
        });
      } else {
        items.push({
          type: 'licence',
          name: 'Vehicle Licence',
          expiryDate: null,
          status: 'unknown',
          daysRemaining: null,
        });
      }

      // Roadworthy.
      if (v.roadworthyTestDate) {
        const expiry = new Date(v.roadworthyTestDate);
        expiry.setFullYear(expiry.getFullYear() + 1);
        const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        items.push({
          type: 'roadworthy',
          name: 'Roadworthy Test',
          expiryDate: expiry.toISOString().split('T')[0],
          status: days < 0 ? 'expired' : days <= 30 ? 'expiring_soon' : 'valid',
          daysRemaining: days,
        });
      } else {
        items.push({
          type: 'roadworthy',
          name: 'Roadworthy Test',
          expiryDate: null,
          status: 'unknown',
          daysRemaining: null,
        });
      }

      // Insurance documents are retained as history, so evaluating every record
      // would let an old expired policy override a newer replacement. Compliance
      // instead follows the newest verified policy. A newly uploaded renewal does
      // not grant compliance until it has been verified.
      const insuranceDocs = docItems.filter((d) => d.documentType === 'insurance');
      const newestFirst = (a: (typeof insuranceDocs)[number], b: (typeof insuranceDocs)[number]) => {
        const aTime = a.issueDate ? new Date(a.issueDate).getTime() : a.createdAt.getTime();
        const bTime = b.issueDate ? new Date(b.issueDate).getTime() : b.createdAt.getTime();
        return bTime - aTime;
      };
      const verifiedInsuranceDocs = insuranceDocs.filter((d) => d.isVerified).sort(newestFirst);
      const currentInsurance = verifiedInsuranceDocs[0] ?? null;

      if (currentInsurance) {
        if (currentInsurance.expiryDate) {
          const expiry = new Date(currentInsurance.expiryDate);
          const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          items.push({
            type: 'insurance',
            name: currentInsurance.documentName,
            expiryDate: currentInsurance.expiryDate,
            status: days < 0 ? 'expired' : days <= 30 ? 'expiring_soon' : 'valid',
            daysRemaining: days,
          });
        } else {
          items.push({
            type: 'insurance',
            name: currentInsurance.documentName,
            expiryDate: null,
            status: 'unknown',
            daysRemaining: null,
          });
        }
      } else if (insuranceDocs.length > 0) {
        const pendingInsurance = [...insuranceDocs].sort(newestFirst)[0];
        items.push({
          type: 'insurance',
          name: `${pendingInsurance.documentName} (Pending verification)`,
          expiryDate: pendingInsurance.expiryDate,
          status: 'unknown',
          daysRemaining: null,
        });
      } else {
        items.push({
          type: 'insurance',
          name: 'Insurance',
          expiryDate: null,
          status: 'unknown',
          daysRemaining: null,
        });
      }

      const expiredCount = items.filter((i) => i.status === 'expired').length;
      const expiringCount = items.filter((i) => i.status === 'expiring_soon').length;
      const unknownCount = items.filter((i) => i.status === 'unknown').length;
      const overallStatus =
        expiredCount > 0
          ? 'non_compliant'
          : expiringCount > 0
            ? 'attention_needed'
            : unknownCount > 0
              ? 'incomplete'
              : 'compliant';

      return {
        vehicleId: v.id,
        licenceNumber: v.licenceNumber,
        make: v.make,
        model: v.model,
        status: v.status,
        currentOdometer: v.currentOdometer,
        overallStatus,
        expiredCount,
        expiringCount,
        unknownCount,
        items,
      };
    });

    const compliant = complianceData.filter((c) => c.overallStatus === 'compliant').length;
    const attentionNeeded = complianceData.filter((c) => c.overallStatus === 'attention_needed').length;
    const nonCompliant = complianceData.filter((c) => c.overallStatus === 'non_compliant').length;
    const incomplete = complianceData.filter((c) => c.overallStatus === 'incomplete').length;

    const upcomingExpiries = complianceData
      .flatMap((c) =>
        c.items
          .filter((i) => i.status === 'expiring_soon' || i.status === 'expired')
          .map((i) => ({
            vehicleId: c.vehicleId,
            licenceNumber: c.licenceNumber,
            type: i.type,
            name: i.name,
            expiryDate: i.expiryDate,
            daysRemaining: i.daysRemaining,
            status: i.status,
          })),
      )
      .sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999));

    return NextResponse.json({
      vehicles: complianceData,
      summary: {
        total: complianceData.length,
        compliant,
        attentionNeeded,
        nonCompliant,
        incomplete,
      },
      upcomingExpiries,
    });
  } catch (error) {
    console.error('[compliance] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch compliance data' }, { status: 500 });
  }
}
