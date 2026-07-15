import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fuelTransactions, reimbursements } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { trips } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { maintenanceEvents } from '@/db/schema/fleet';
import { sql, eq, and, gte, count } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get('type') || 'fuel';
    const tenantId = searchParams.get('tenantId') || '00000000-0000-0000-0000-000000000001';
    const period = searchParams.get('period') || '30d';

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const db = getDb();

    switch (reportType) {
      case 'fuel': {
        // Fuel consumption summary
        const fuelSummary = await db
          .select({
            totalLitres: sql`COALESCE(SUM(litres), 0)`.as('total_litres'),
            totalAmount: sql`COALESCE(SUM(amount), 0)`.as('total_amount'),
            transactionCount: count(),
            avgCostPerLitre: sql`COALESCE(SUM(amount) / NULLIF(SUM(litres), 0), 0)`.as('avg_cost'),
          })
          .from(fuelTransactions)
          .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              gte(fuelTransactions.createdAt, startDate),
            ),
          );

        // Top fuel-consuming vehicles
        const topConsumers = await db
          .select({
            vehicleId: fuelTransactions.vehicleId,
            grnNumber: vehicles.grnNumber,
            litres: sql`COALESCE(SUM(${fuelTransactions.litres}), 0)`.as('total_litres'),
            amount: sql`COALESCE(SUM(${fuelTransactions.amount}), 0)`.as('total_amount'),
          })
          .from(fuelTransactions)
          .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              gte(fuelTransactions.createdAt, startDate),
            ),
          )
          .groupBy(fuelTransactions.vehicleId, vehicles.grnNumber)
          .orderBy(sql`total_litres DESC`)
          .limit(10);

        // Reimbursement summary
        const reimbursementSummary = await db
          .select({
            totalPending: count(),
            totalAmount: sql`COALESCE(SUM(reimbursements.amount), 0)`.as('total_amount'),
          })
          .from(reimbursements)
          .innerJoin(fuelTransactions, eq(reimbursements.transactionId, fuelTransactions.id))
          .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              eq(reimbursements.state, 'pending'),
            ),
          );

        return NextResponse.json({
          success: true,
          data: {
            summary: fuelSummary[0],
            topConsumers,
            reimbursements: reimbursementSummary[0],
          },
        });
      }

      case 'fleet': {
        // Fleet status distribution
        const fleetStatus = await db
          .select({
            status: vehicles.status,
            count: count(),
          })
          .from(vehicles)
          .where(eq(vehicles.tenantId, tenantId))
          .groupBy(vehicles.status);

        // Total vehicles
        const [totalVehicles] = await db
          .select({ count: count() })
          .from(vehicles)
          .where(eq(vehicles.tenantId, tenantId));

        return NextResponse.json({
          success: true,
          data: {
            statusDistribution: fleetStatus,
            totalVehicles: totalVehicles?.count || 0,
          },
        });
      }

      case 'trips': {
        // Trip statistics
        const tripStats = await db
          .select({
            totalTrips: count(),
            status: trips.status,
          })
          .from(trips)
          .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              gte(trips.createdAt, startDate),
            ),
          )
          .groupBy(trips.status);

        return NextResponse.json({
          success: true,
          data: { tripStats },
        });
      }

      case 'requests': {
        // Request statistics
        const requestStats = await db
          .select({
            totalRequests: count(),
            status: transportRequests.status,
          })
          .from(transportRequests)
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              gte(transportRequests.createdAt, startDate),
            ),
          )
          .groupBy(transportRequests.status);

        return NextResponse.json({
          success: true,
          data: { requestStats },
        });
      }

      case 'maintenance': {
        const maintStats = await db
          .select({
            totalEvents: count(),
            totalCost: sql`COALESCE(SUM(${maintenanceEvents.cost}), 0)`.as('total_cost'),
            serviceType: maintenanceEvents.serviceType,
          })
          .from(maintenanceEvents)
          .innerJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              gte(maintenanceEvents.serviceDate, startDate.toISOString().split('T')[0]),
            ),
          )
          .groupBy(maintenanceEvents.serviceType);

        return NextResponse.json({
          success: true,
          data: { maintenanceStats: maintStats },
        });
      }

      default: {
        // Dashboard summary - aggregate across all modules
        const [activeRequests] = await db
          .select({ count: count() })
          .from(transportRequests)
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              sql`${transportRequests.status} NOT IN ('closed', 'cancelled')`,
            ),
          );

        const [activeTrips] = await db
          .select({ count: count() })
          .from(trips)
          .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              sql`${trips.status} IN ('pending', 'in_progress')`,
            ),
          );

        const [openDefects] = await db
          .select({ count: count() })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              eq(vehicles.status, 'maintenance'),
            ),
          );

        return NextResponse.json({
          success: true,
          data: {
            activeRequests: activeRequests?.count || 0,
            activeTrips: activeTrips?.count || 0,
            openDefects: openDefects?.count || 0,
          },
        });
      }
    }
  } catch (error) {
    console.error('Reports API failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate report: ' + String(error) },
      { status: 500 },
    );
  }
}
