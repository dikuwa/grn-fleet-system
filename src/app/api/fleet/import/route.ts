import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { importBatches, importRows } from '@/db/schema/notifications';
import { vehicles } from '@/db/schema/fleet';
import { eq, and, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

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

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    // Authenticate and authorise
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.VEHICLE_CREATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const userId = session.user.id;
    const tenantId = session.tenantId;

    const { rows } = body as { rows: VehicleImportRow[] };

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }

    // Create import batch
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

    // Process each row
    for (const row of rows) {
      try {
        // Validate required fields
        if (!row.licence_number?.trim()) throw new Error('Licence number is required');
        if (!row.make?.trim()) throw new Error('Make is required');
        if (!row.model?.trim()) throw new Error('Model is required');

        // Check for duplicate licence number within tenant
        const [existing] = await db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.licenceNumber, row.licence_number.trim()),
              eq(vehicles.tenantId, tenantId),
              eq(vehicles.isActive, true),
            ),
          )
          .limit(1);

        if (existing) {
          // Update existing vehicle
          await db
            .update(vehicles)
            .set({
              vehicleRegisterNumber: row.vehicle_register_number?.trim() || null,
              vin: row.vin?.trim() || null,
              engineNumber: row.engine_number?.trim() || null,
              make: row.make.trim(),
              model: row.model.trim(),
              seriesName: row.series_name?.trim() || null,
              manufactureYear: row.manufacture_year ? Number(row.manufacture_year) : null,
              colour: row.colour?.trim() || null,
              fuelType: row.fuel_type?.trim() || 'petrol',
              transmission: row.transmission?.trim() || 'manual',
              vehicleCategory: row.vehicle_category?.trim() || null,
              vehicleDescription: row.vehicle_description?.trim() || null,
              tareKg: row.tare_kg ? Number(row.tare_kg) : null,
              grossVehicleMassKg: row.gross_vehicle_mass_kg ? Number(row.gross_vehicle_mass_kg) : null,
              seatedCapacity: row.seated_capacity ? Number(row.seated_capacity) : null,
              standingCapacity: row.standing_capacity ? Number(row.standing_capacity) : null,
              status: row.status?.trim() || 'available',
              currentOdometer: row.current_odometer ? Number(row.current_odometer) : 0,
              notes: row.notes?.trim() || null,
              updatedBy: userId,
              updatedAt: sql`now()`,
            })
            .where(eq(vehicles.id, existing.id));

          await db.insert(importRows).values({
            batchId: batch.id,
            rowNumber: validCount + errorCount + 1,
            rawData: row as unknown as Record<string, unknown>,
            isCommitted: true,
            commitEntityId: existing.id,
          });
        } else {
          // Insert new vehicle
          const [vehicle] = await db
            .insert(vehicles)
            .values({
              tenantId,
              licenceNumber: row.licence_number.trim(),
              vehicleRegisterNumber: row.vehicle_register_number?.trim() || null,
              vin: row.vin?.trim() || null,
              engineNumber: row.engine_number?.trim() || null,
              make: row.make.trim(),
              model: row.model.trim(),
              seriesName: row.series_name?.trim() || null,
              manufactureYear: row.manufacture_year ? Number(row.manufacture_year) : null,
              colour: row.colour?.trim() || null,
              fuelType: row.fuel_type?.trim() || 'petrol',
              transmission: row.transmission?.trim() || 'manual',
              vehicleCategory: row.vehicle_category?.trim() || null,
              vehicleDescription: row.vehicle_description?.trim() || null,
              tareKg: row.tare_kg ? Number(row.tare_kg) : null,
              grossVehicleMassKg: row.gross_vehicle_mass_kg ? Number(row.gross_vehicle_mass_kg) : null,
              seatedCapacity: row.seated_capacity ? Number(row.seated_capacity) : null,
              standingCapacity: row.standing_capacity ? Number(row.standing_capacity) : null,
              status: row.status?.trim() || 'available',
              currentOdometer: row.current_odometer ? Number(row.current_odometer) : 0,
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

    // Update batch status
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
    return NextResponse.json(
      { error: 'Vehicle import failed: ' + String(error) },
      { status: 500 },
    );
  }
}
