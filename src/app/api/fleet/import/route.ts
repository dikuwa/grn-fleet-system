import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { importBatches, importRows } from '@/db/schema/notifications';
import { vehicles } from '@/db/schema/fleet';
import { eq, and, sql, inArray, count } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { checkEntitlement, getTenantEntitlements } from '@/lib/entitlements';

interface VehicleImportRow {
  licence_number: string;
  vehicle_register_number?: string;
  vin?: string;
  engine_number?: string;
  make: string;
  model: string;
  series_name?: string;
  manufacture_year?: string;
  colour?: string;
  fuel_type?: string;
  transmission?: string;
  vehicle_category?: string;
  vehicle_description?: string;
  tare_kg?: string;
  gross_vehicle_mass_kg?: string;
  seated_capacity?: string;
  standing_capacity?: string;
  status?: string;
  current_odometer?: string;
  office?: string;
  category?: string;
  notes?: string;
}

const MAX_IMPORT_ROWS = 1000;
const IMPORTABLE_STATUSES = new Set(['available', 'provisional', 'maintenance', 'out_of_service']);

function optionalNonNegativeInteger(value: string | undefined, label: string) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative whole number`);
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate before parsing or processing a potentially large import body.
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/fleet/import', 'import');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.VEHICLE_CREATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { rows } = body as { rows?: VehicleImportRow[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Import at most ${MAX_IMPORT_ROWS} vehicles per batch` },
        { status: 413 },
      );
    }

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    // Bulk import must honour the same subscription vehicle ceiling as the
    // single-vehicle create route. Only rows that would insert a new active
    // licence number count as incoming capacity; updates do not consume slots.
    const uniqueLicenceNumbers = Array.from(
      new Set(
        rows
          .map((row) => row.licence_number?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const existingLicenceRows = uniqueLicenceNumbers.length
      ? await db
          .select({ licenceNumber: vehicles.licenceNumber })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.tenantId, tenantId),
              eq(vehicles.isActive, true),
              inArray(vehicles.licenceNumber, uniqueLicenceNumbers),
            ),
          )
      : [];
    const existingLicenceNumbers = new Set(existingLicenceRows.map((row) => row.licenceNumber));
    const incomingVehicleCount = uniqueLicenceNumbers.filter(
      (licenceNumber) => !existingLicenceNumbers.has(licenceNumber),
    ).length;

    const entitlements = await getTenantEntitlements(tenantId);
    if (entitlements && incomingVehicleCount > 0) {
      const [countRow] = await db
        .select({ total: count() })
        .from(vehicles)
        .where(eq(vehicles.tenantId, tenantId));
      const entitlementCheck = checkEntitlement(
        entitlements,
        'vehicles',
        countRow?.total ?? 0,
        incomingVehicleCount,
      );
      if (!entitlementCheck.ok) {
        return NextResponse.json(
          { error: entitlementCheck.message || 'Vehicle limit reached' },
          { status: 409 },
        );
      }
    }

    // Create import batch only after the whole-request guards pass.
    const [batch] = await db
      .insert(importBatches)
      .values({
        tenantId,
        importType: 'vehicles',
        fileName: 'CSV Import',
        fileKey: '',
        status: 'validated',
        totalRows: rows.length,
        validRows: 0,
        errorRows: 0,
        importedByUserId: userId,
      })
      .returning();

    let validCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      try {
        const licenceNumber = row.licence_number?.trim();
        const make = row.make?.trim();
        const model = row.model?.trim();
        if (!licenceNumber) throw new Error('Licence number is required');
        if (!make) throw new Error('Make is required');
        if (!model) throw new Error('Model is required');

        const manufactureYear = optionalNonNegativeInteger(row.manufacture_year, 'Manufacture year');
        const tareKg = optionalNonNegativeInteger(row.tare_kg, 'Tare weight');
        const grossVehicleMassKg = optionalNonNegativeInteger(
          row.gross_vehicle_mass_kg,
          'Gross vehicle mass',
        );
        const seatedCapacity = optionalNonNegativeInteger(row.seated_capacity, 'Seated capacity');
        const standingCapacity = optionalNonNegativeInteger(row.standing_capacity, 'Standing capacity');
        const importedOdometer = optionalNonNegativeInteger(row.current_odometer, 'Current odometer');
        const importedStatus = row.status?.trim() || null;
        if (importedStatus && !IMPORTABLE_STATUSES.has(importedStatus)) {
          throw new Error(
            'Status must be available, provisional, maintenance, or out_of_service. Allocation, issued, and written-off states are managed by dedicated workflows.',
          );
        }

        const [existing] = await db
          .select({
            id: vehicles.id,
            status: vehicles.status,
            currentOdometer: vehicles.currentOdometer,
          })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.licenceNumber, licenceNumber),
              eq(vehicles.tenantId, tenantId),
              eq(vehicles.isActive, true),
            ),
          )
          .limit(1);

        if (existing) {
          if (
            importedStatus &&
            importedStatus !== existing.status &&
            ['allocated', 'issued'].includes(existing.status)
          ) {
            throw new Error(
              `Vehicle is currently ${existing.status}; its status cannot be overridden by an import while the operational workflow is active.`,
            );
          }

          await db
            .update(vehicles)
            .set({
              vehicleRegisterNumber: row.vehicle_register_number?.trim() || null,
              vin: row.vin?.trim() || null,
              engineNumber: row.engine_number?.trim() || null,
              make,
              model,
              seriesName: row.series_name?.trim() || null,
              manufactureYear,
              colour: row.colour?.trim() || null,
              fuelType: row.fuel_type?.trim() || 'petrol',
              transmission: row.transmission?.trim() || 'manual',
              vehicleCategory: row.vehicle_category?.trim() || null,
              vehicleDescription: row.vehicle_description?.trim() || null,
              tareKg,
              grossVehicleMassKg,
              seatedCapacity,
              standingCapacity,
              status: importedStatus || existing.status,
              currentOdometer:
                importedOdometer === null
                  ? existing.currentOdometer
                  : Math.max(existing.currentOdometer, importedOdometer),
              notes: row.notes?.trim() || null,
              updatedBy: userId,
              updatedAt: sql`now()`,
            })
            .where(and(eq(vehicles.id, existing.id), eq(vehicles.tenantId, tenantId)));

          await db.insert(importRows).values({
            batchId: batch.id,
            rowNumber: validCount + errorCount + 1,
            rawData: row as unknown as Record<string, unknown>,
            isCommitted: true,
            commitEntityId: existing.id,
          });
        } else {
          const [vehicle] = await db
            .insert(vehicles)
            .values({
              tenantId,
              licenceNumber,
              vehicleRegisterNumber: row.vehicle_register_number?.trim() || null,
              vin: row.vin?.trim() || null,
              engineNumber: row.engine_number?.trim() || null,
              make,
              model,
              seriesName: row.series_name?.trim() || null,
              manufactureYear,
              colour: row.colour?.trim() || null,
              fuelType: row.fuel_type?.trim() || 'petrol',
              transmission: row.transmission?.trim() || 'manual',
              vehicleCategory: row.vehicle_category?.trim() || null,
              vehicleDescription: row.vehicle_description?.trim() || null,
              tareKg,
              grossVehicleMassKg,
              seatedCapacity,
              standingCapacity,
              status: importedStatus || 'available',
              currentOdometer: importedOdometer ?? 0,
              notes: row.notes?.trim() || null,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning();

          await db.insert(importRows).values({
            batchId: batch.id,
            rowNumber: validCount + errorCount + 1,
            rawData: row as unknown as Record<string, unknown>,
            isCommitted: true,
            commitEntityId: vehicle.id,
          });
        }

        validCount++;
      } catch (rowError) {
        errorCount++;
        await db.insert(importRows).values({
          batchId: batch.id,
          rowNumber: validCount + errorCount,
          rawData: row as unknown as Record<string, unknown>,
          validationErrors: [String(rowError)],
          isCommitted: false,
        });
      }
    }

    const batchStatus =
      errorCount > 0 && validCount > 0
        ? 'partially_committed'
        : errorCount > 0
          ? 'failed'
          : 'committed';
    await db
      .update(importBatches)
      .set({
        status: batchStatus,
        validRows: validCount,
        errorRows: errorCount,
        committedRows: validCount,
        committedAt: sql`now()`,
      })
      .where(eq(importBatches.id, batch.id));

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      validRows: validCount,
      errorRows: errorCount,
    });
  } catch (error) {
    console.error('Vehicle import failed:', error);
    return NextResponse.json({ error: 'Vehicle import failed' }, { status: 500 });
  }
}
