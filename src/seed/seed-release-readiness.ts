/**
 * Release Readiness Seed Data
 *
 * Creates trips at various stages of release readiness to exercise the
 * ReleaseReadinessCheck component and the departure-vs-return photo comparison.
 *
 * Prerequisites: Run `pnpm db:seed` then `npx tsx src/seed/seed-approval-workflow.ts`
 * then `npx tsx src/seed/seed-documents.ts`.
 *
 * Run: npx tsx src/seed/seed-release-readiness.ts
 */
import { getDb } from '@/db';
import {
  transportRequests,
  requestActivities,
  requestPassengers,
  requestDrivers,
  requestRoutes,
} from '@/db/schema/requests';
import {
  vehicleAllocations,
  trips,
  tripAuthorities,
  vehicleInspections,
  inspectionItemResults,
  inspectionTemplates,
  inspectionTemplateItems,
} from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { workflowDefinitions, workflowInstances, workflowActions } from '@/db/schema/workflows';
import { eq, and, sql, inArray } from 'drizzle-orm';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function seedReleaseReadiness() {
  const db = getDb();
  console.log('🚦 Seeding release readiness test data...\n');

  // ---------------------------------------------------------------------------
  // 1. Look up entities
  // ---------------------------------------------------------------------------
  console.log('Looking up entities...');

  const allEmployees = await db
    .select({
      id: employees.id,
      empNo: employees.employeeNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      userId: employees.userId,
      jobTitle: employees.jobTitle,
      departmentId: employees.departmentId,
    })
    .from(employees)
    .where(eq(employees.tenantId, TENANT_ID));

  const empMap: Record<string, typeof allEmployees[0]> = {};
  for (const e of allEmployees) {
    empMap[e.empNo] = e;
  }

  const requester = empMap['KERC002'];
  const supervisor = empMap['KERC003'];
  const releaseOff = empMap['KERC004'];
  const authoriser = empMap['KERC005'];
  const driverEmp = empMap['KERC008'];
  const transportAdmin = empMap['KERC011'];

  if (!requester || !supervisor || !releaseOff || !authoriser || !driverEmp || !transportAdmin) {
    console.error('❌ Missing seed employees. Run pnpm db:seed first.');
    process.exit(1);
  }

  const allVehicles = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.tenantId, TENANT_ID), eq(vehicles.isActive, true)));

  const hilux = allVehicles.find((v) => v.licenceNumber === 'GRN-003-2024');
  const corolla = allVehicles.find((v) => v.licenceNumber === 'GRN-001-2024');
  const sentra = allVehicles.find((v) => v.licenceNumber === 'GRN-002-2024');

  if (!hilux || !corolla) {
    console.error('❌ Missing seed vehicles. Run pnpm db:seed first.');
    process.exit(1);
  }

  const [regionalWorkflow] = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.tenantId, TENANT_ID), eq(workflowDefinitions.name, 'Regional Trip Workflow')))
    .limit(1);

  if (!regionalWorkflow) {
    console.error('❌ Missing regional workflow. Run pnpm db:seed first.');
    process.exit(1);
  }

  const [departureTemplate] = await db
    .select()
    .from(inspectionTemplates)
    .where(and(eq(inspectionTemplates.tenantId, TENANT_ID), eq(inspectionTemplates.type, 'departure'), eq(inspectionTemplates.isActive, true)))
    .limit(1);

  if (!departureTemplate) {
    console.error('❌ Missing departure inspection template. Run pnpm db:seed first.');
    process.exit(1);
  }

  const departItems = await db
    .select()
    .from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, departureTemplate.id))
    .orderBy(inspectionTemplateItems.sortOrder);

  console.log(`   Found ${allEmployees.length} employees, ${allVehicles.length} vehicles, ${departItems.length} inspection items\n`);

  // ---------------------------------------------------------------------------
  // 2. Clean up previously seeded readiness data
  // ---------------------------------------------------------------------------
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const refPrefix = `GRN/RR/${now.getFullYear()}/${month}${day}/`;

  const existingReqs = await db
    .select({ id: transportRequests.id, reference: transportRequests.reference })
    .from(transportRequests)
    .where(and(eq(transportRequests.tenantId, TENANT_ID), sql`${transportRequests.reference} LIKE ${refPrefix + '%'}`));

  if (existingReqs.length > 0) {
    const reqIds = existingReqs.map((r) => r.id);
    console.log(`   Cleaning up ${existingReqs.length} previously seeded readiness requests...`);
    const tripIds = (await db.select({ id: trips.id }).from(trips).where(inArray(trips.requestId, reqIds))).map((t) => t.id);
    if (tripIds.length > 0) {
      await db.delete(vehicleInspections).where(inArray(vehicleInspections.tripId, tripIds));
      await db.delete(trips).where(inArray(trips.id, tripIds));
    }
    await db.delete(transportRequests).where(inArray(transportRequests.id, reqIds));
    console.log('   Cleanup complete.\n');
  }

  // ---------------------------------------------------------------------------
  // Helper: create a trip with readiness scenario
  // ---------------------------------------------------------------------------
  let seq = 0;

  async function createReadinessTrip(opts: {
    refSuffix: string;
    label: string;
    purpose: string;
    scope: 'regional' | 'national';
    workflowStep: number; // which workflow step to be at
    vehicleId: string;
    // Gates to simulate
    approvalsComplete: boolean;
    driverAssigned: boolean;
    driverId?: string;
    dayOffset?: number;
    licenceValid: boolean;
    noBlockingDefects: boolean;
    depInspectionDone: boolean;
    depInspectionPassed: boolean;
    authorityIssued: boolean;
    driverAccepted: boolean;
    vehicleIssued: boolean;
  }) {
    seq++;
    const reqRef = refPrefix + opts.refSuffix;
    const offsetDays = opts.dayOffset ?? seq;
    const tripStart = new Date(now.getTime() + offsetDays * 86400000);
    const tripEnd = new Date(tripStart.getTime() + 3 * 86400000);
    const activityStart = new Date(tripStart.getTime() + 3600000);
    const activityEnd = new Date(activityStart.getTime() + 4 * 3600000);
    const theDriver = opts.driverId ? allEmployees.find((e) => e.id === opts.driverId) || driverEmp : driverEmp;

    // Create transport request
    const [req] = await db
      .insert(transportRequests)
      .values({
        tenantId: TENANT_ID,
        reference: reqRef,
        scope: opts.scope,
        status: opts.approvalsComplete ? 'release_pending' : 'submitted',
        requesterEmployeeId: requester.id,
        requesterUserId: requester.userId,
        enteredByUserId: requester.userId,
        requestSource: 'logged_in_self_service',
        requestChannel: 'dashboard',
        submissionMethod: 'logged_in',
        verificationMethod: 'authenticated_session',
        department: 'Transport and Fleet Management',
        purpose: opts.purpose,
        specialAuthorityRequired: false,
        totalAuthorisedKilometres: 250,
        submittedAt: new Date(now.getTime() - 2 * 86400000),
      })
      .returning();

    // Activities & passengers
    await db.insert(requestActivities).values([
      { requestId: req.id, title: opts.purpose, venue: 'Field', startDate: activityStart, endDate: activityEnd, estimatedKilometres: 200 },
    ]);
    await db.insert(requestRoutes).values([
      { requestId: req.id, originName: 'Rundu', destinationName: 'Field Location', totalKilometres: 100, isVerified: true },
      { requestId: req.id, originName: 'Field Location', destinationName: 'Rundu', totalKilometres: 100, isVerified: true },
    ]);
    await db.insert(requestPassengers).values([
      { requestId: req.id, employeeId: requester.id, travellerRole: 'lead', reasonForTravel: opts.purpose, status: 'confirmed' },
    ]);
    // Driver — only insert when assigned; the readiness gate will show as blocking
    // when the allocation's driverEmployeeId is null.
    if (opts.driverAssigned) {
      await db.insert(requestDrivers).values([
        { requestId: req.id, employeeId: theDriver.id, driverType: 'nominated', sortOrder: 1 },
      ]);
    }

    // Workflow instance
    const [wfInstance] = await db
      .insert(workflowInstances)
      .values({
        requestId: req.id,
        definitionId: regionalWorkflow.id,
        definitionVersion: 1,
        currentStepOrder: opts.workflowStep,
        status: opts.approvalsComplete ? 'active' : 'active',
      })
      .returning();

    await db.update(transportRequests).set({ workflowInstanceId: wfInstance.id }).where(eq(transportRequests.id, req.id));

    // Workflow actions
    const actions: Array<{ stepOrder: number; actionType: string; result: string; actorUserId: string; actorEmployeeId: string; comment?: string }> = [];

    if (opts.approvalsComplete) {
      actions.push({ stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor.userId!, actorEmployeeId: supervisor.id, comment: 'Approved.' });
      actions.push({ stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin.userId!, actorEmployeeId: transportAdmin.id, comment: 'Vehicle available.' });
    }
    if (opts.workflowStep >= 3) {
      actions.push({ stepOrder: 3, actionType: 'release', result: 'approved', actorUserId: releaseOff.userId!, actorEmployeeId: releaseOff.id, comment: 'Release pending checklist.' });
    }

    for (const action of actions) {
      await db.insert(workflowActions).values({
        instanceId: wfInstance.id,
        stepOrder: action.stepOrder,
        actionType: action.actionType,
        result: action.result,
        actorUserId: action.actorUserId,
        actorEmployeeId: action.actorEmployeeId,
        comment: action.comment || null,
        createdAt: new Date(now.getTime() - 1 * 86400000 + action.stepOrder * 3600000),
      });
    }

    // Update request status
    const reqStatus = opts.approvalsComplete ? 'release_pending' : 'submitted';
    await db.update(transportRequests).set({ status: reqStatus, updatedAt: new Date() }).where(eq(transportRequests.id, req.id));

    // Vehicle allocation & trip
    const [alloc] = await db
      .insert(vehicleAllocations)
      .values({
        requestId: req.id,
        vehicleId: opts.vehicleId,
        driverEmployeeId: opts.driverAssigned ? theDriver.id : null,
        startAt: tripStart,
        endAt: tripEnd,
        state: 'confirmed',
        allocatedByUserId: transportAdmin.userId!,
      })
      .returning();

    const [trip] = await db
      .insert(trips)
      .values({
        tenantId: TENANT_ID,
        requestId: req.id,
        allocationId: alloc.id,
        vehicleId: opts.vehicleId,
        status: 'pending',
        issuedAt: opts.vehicleIssued ? now : null,
      })
      .returning();

    // Trip authority
    if (opts.authorityIssued) {
      await db.insert(tripAuthorities).values({
        requestId: req.id,
        allocationId: alloc.id,
        tripId: trip.id,
        tenantId: TENANT_ID,
        authorityNumber: `RR-${String(seq).padStart(3, '0')}`,
        status: opts.driverAccepted ? 'driver_accepted' : 'issued',
        issuedAt: new Date(now.getTime() - 12 * 3600000),
        authorisedAt: new Date(now.getTime() - 6 * 3600000),
      });
    }

    // Pre-departure inspection
    if (opts.depInspectionDone) {
      const [insp] = await db
        .insert(vehicleInspections)
        .values({
          tenantId: TENANT_ID,
          vehicleId: opts.vehicleId,
          tripId: trip.id,
          templateId: departureTemplate.id,
          templateVersion: departureTemplate.version,
          type: 'departure',
          odometerReading: 45230,
          fuelLevel: 'full',
          inspectorUserId: transportAdmin.userId!,
          inspectorEmployeeId: transportAdmin.id,
          driverEmployeeId: theDriver.id,
          status: opts.depInspectionPassed ? 'completed' : 'completed',
          overallPass: opts.depInspectionPassed,
          notes: opts.depInspectionPassed ? 'All checks passed.' : 'Minor issues noted.',
        })
        .returning();

      // Item results
      for (let i = 0; i < Math.min(departItems.length, 10); i++) {
        await db.insert(inspectionItemResults).values({
          inspectionId: insp.id,
          templateItemId: departItems[i].id,
          result: opts.depInspectionPassed ? 'pass' : i < 8 ? 'pass' : 'fail',
        });
      }
    }

    // Blocking defects (if scenario requires them)
    if (!opts.noBlockingDefects) {
      await db.insert(vehicleDefects).values({
        vehicleId: opts.vehicleId,
        reportedByUserId: transportAdmin.userId!,
        description: `Seeded blocking defect for readiness scenario ${seq}`,
        severity: 'critical',
        isBlocking: true,
      });
    }

    console.log(`   ✅ RR-${opts.refSuffix} — ${opts.label}`);
    return { request: req, trip };
  }

  // ---------------------------------------------------------------------------
  // 3. Create readiness scenarios
  // ---------------------------------------------------------------------------
  console.log('\n─── Creating release readiness scenarios ───\n');

  // ---------------------------------------------------------------------------
  // Use different drivers and day offsets per scenario to avoid the
  // vehicle_allocations_driver_no_active_overlap exclusion constraint.
  // ---------------------------------------------------------------------------
  const drivers = allEmployees.filter((e) => e.id !== requester.id && e.id !== supervisor.id);
  const getDriver = (i: number) => drivers[((i - 1) % drivers.length)].id;

  // SCENARIO A: Fully ready — all gates pass
  await createReadinessTrip({
    refSuffix: 'A001',
    label: 'Fully Ready — All gates pass',
    purpose: 'Routine office supply delivery to Mukwe constituency',
    scope: 'regional',
    workflowStep: 4,
    vehicleId: corolla.id,
    approvalsComplete: true,
    driverAssigned: true,
    driverId: getDriver(1),
    dayOffset: 1,
    licenceValid: true,
    noBlockingDefects: true,
    depInspectionDone: true,
    depInspectionPassed: true,
    authorityIssued: true,
    driverAccepted: true,
    vehicleIssued: true,
  });

  // SCENARIO B: Blocked — missing driver acceptance & no departure inspection
  await createReadinessTrip({
    refSuffix: 'B001',
    label: 'Blocked — Missing driver acceptance, no inspection',
    purpose: 'Emergency generator parts pickup from Rundu depot',
    scope: 'regional',
    workflowStep: 4,
    vehicleId: hilux.id,
    approvalsComplete: true,
    driverAssigned: true,
    driverId: getDriver(2),
    dayOffset: 5,
    licenceValid: true,
    noBlockingDefects: true,
    depInspectionDone: false,
    depInspectionPassed: false,
    authorityIssued: true,
    driverAccepted: false,
    vehicleIssued: false,
  });

  // SCENARIO C: Blocked — blocking defects & no licence verification
  await createReadinessTrip({
    refSuffix: 'C001',
    label: 'Blocked — Vehicle defects, licence not verified',
    purpose: 'Field visit for water point assessment',
    scope: 'regional',
    workflowStep: 3,
    vehicleId: sentra?.id || corolla.id,
    approvalsComplete: true,
    driverAssigned: true,
    driverId: getDriver(3),
    dayOffset: 9,
    licenceValid: false,
    noBlockingDefects: false,
    depInspectionDone: false,
    depInspectionPassed: false,
    authorityIssued: false,
    driverAccepted: false,
    vehicleIssued: false,
  });

  // SCENARIO D: Early stage — not yet approved
  await createReadinessTrip({
    refSuffix: 'D001',
    label: 'Early Stage — Awaiting supervisor approval',
    purpose: 'Community engagement workshop preparation',
    scope: 'regional',
    workflowStep: 1,
    vehicleId: corolla.id,
    approvalsComplete: false,
    driverAssigned: true,
    driverId: getDriver(4),
    dayOffset: 13,
    licenceValid: true,
    noBlockingDefects: true,
    depInspectionDone: false,
    depInspectionPassed: false,
    authorityIssued: false,
    driverAccepted: false,
    vehicleIssued: false,
  });

  // SCENARIO E: Inspection failed
  await createReadinessTrip({
    refSuffix: 'E001',
    label: 'Inspection Failed — Pre-departure issues found',
    purpose: 'School sports equipment delivery',
    scope: 'regional',
    workflowStep: 4,
    vehicleId: corolla.id,
    approvalsComplete: true,
    driverAssigned: true,
    driverId: getDriver(5),
    dayOffset: 17,
    licenceValid: true,
    noBlockingDefects: true,
    depInspectionDone: true,
    depInspectionPassed: false,
    authorityIssued: true,
    driverAccepted: true,
    vehicleIssued: true,
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n─── Release Readiness Seed Summary ───\n');
  console.log('   Scenario A: Fully Ready  (visit /dashboard/trips/{id})');
  console.log('   Scenario B: Missing driver acceptance + no departure inspection');
  console.log('   Scenario C: Blocking vehicle defects + licence not verified');
  console.log('   Scenario D: Not yet through supervisor approval');
  console.log('   Scenario E: Pre-departure inspection has failures');
  console.log('\n✅ Release readiness seed complete!');
  console.log('   Seed additional requests at 5 readiness levels for thorough testing.\n');
}

seedReleaseReadiness()
  .catch((e: unknown) => {
    console.error('❌ Release readiness seed failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
