/**
 * Document Seed Data
 *
 * Creates Transport Requests, Trip Authorities, Inspections, Fuel transactions,
 * and generated document snapshots so the document pages show rich real data.
 *
 * Prerequisites: Run `pnpm db:seed` first to create tenants, employees, vehicles.
 *
 * Run: npx tsx src/seed/seed-documents.ts
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
  fuelTransactions,
  tripClosures,
  tripProgressEntries,
} from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles, maintenanceEvents } from '@/db/schema/fleet';
import { workflowDefinitions, workflowSteps, workflowInstances, workflowActions } from '@/db/schema/workflows';
import { generateDocument, onRequestSubmitted, onTripClosed, onInspectionCompleted } from '@/lib/document-generator';
import { provisionTripAuthority } from '@/lib/trip-authority';
import { eq, and, sql, inArray } from 'drizzle-orm';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function seedDocuments() {
  const db = getDb();
  console.log('📄 Seeding operational documents...\n');

  // -------------------------------------------------------------------------
  // 1. Look up seed identities
  // -------------------------------------------------------------------------
  console.log('Looking up seed data...');

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

  const requester = empMap['KERC002']; // Maria Shikongo
  const supervisor = empMap['KERC003']; // Petrus Ndara
  const releaseOff = empMap['KERC004']; // Erastus Hausiku
  const authoriser = empMap['KERC005']; // Loide Kandjiri
  const driverEmp = empMap['KERC008'];  // Michael Mwala
  const driver2    = empMap['KERC009']; // Selma Nangula
  const transportAdmin = empMap['KERC011']; // Ndapewa Hamutenya
  const inspector  = empMap['KERC012']; // Tangeni Ndeitunga

  if (!requester || !supervisor || !releaseOff || !authoriser || !driverEmp || !transportAdmin || !inspector) {
    console.error('❌ Missing seed employees. Run pnpm db:seed first.');
    process.exit(1);
  }

  // Verify all required employees have linked auth user IDs
  // driver2 (Selma Nangula, KERC009) is optional — fall back to primary driver if unavailable
  const requiredEmps = [requester, supervisor, releaseOff, authoriser, driverEmp, transportAdmin, inspector];
  for (const emp of requiredEmps) {
    if (!emp?.userId) {
      console.error(`❌ Employee ${emp?.firstName} ${emp?.lastName} (${emp?.empNo}) has no linked auth user. Run pnpm db:seed first.`);
      process.exit(1);
    }
  }
  const hasDriver2 = !!(driver2?.userId);

  console.log(`   Requester: ${requester.firstName} ${requester.lastName}`);
  console.log(`   Driver: ${driverEmp.firstName} ${driverEmp.lastName}`);
  console.log(`   Inspector: ${inspector.firstName} ${inspector.lastName}`);

  // Vehicles
  const allVehicles = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.tenantId, TENANT_ID), eq(vehicles.isActive, true)));

  const hiluxVehicle = allVehicles.find((v) => v.licenceNumber === 'GRN-003-2024');
  const corollaVehicle = allVehicles.find((v) => v.licenceNumber === 'GRN-001-2024');

  if (!hiluxVehicle || !corollaVehicle) {
    console.error('❌ Missing seed vehicles. Run pnpm db:seed first.');
    process.exit(1);
  }

  // Ensure seeded vehicles have seatedCapacity set (null defaults to 1 in provisionTripAuthority)
  await db.update(vehicles).set({ seatedCapacity: 5 }).where(and(eq(vehicles.tenantId, TENANT_ID), sql`${vehicles.seatedCapacity} IS NULL`));
  console.log(`   Set seatedCapacity=5 on ${allVehicles.filter(v => !v.seatedCapacity).length} vehicles`);

  // Workflow definitions
  const [regionalWorkflow] = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.tenantId, TENANT_ID), eq(workflowDefinitions.name, 'Regional Trip Workflow')))
    .limit(1);

  const [nationalWorkflow] = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.tenantId, TENANT_ID), eq(workflowDefinitions.name, 'National Trip Workflow')))
    .limit(1);

  if (!regionalWorkflow || !nationalWorkflow) {
    console.error('❌ Missing workflow definitions. Run pnpm db:seed first.');
    process.exit(1);
  }

  // Inspection templates
  const [departureTemplate] = await db
    .select()
    .from(inspectionTemplates)
    .where(and(eq(inspectionTemplates.tenantId, TENANT_ID), eq(inspectionTemplates.type, 'departure'), eq(inspectionTemplates.isActive, true)))
    .limit(1);

  if (!departureTemplate) {
    console.error('❌ Missing departure inspection template. Run pnpm db:seed first.');
    process.exit(1);
  }

  // Get inspection template items
  const departItems = await db
    .select()
    .from(inspectionTemplateItems)
    .where(eq(inspectionTemplateItems.templateId, departureTemplate.id))
    .orderBy(inspectionTemplateItems.sortOrder);

  console.log(`   Found ${departItems.length} departure inspection items`);

  // Get workflow steps
  const regionalSteps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.definitionId, regionalWorkflow.id))
    .orderBy(workflowSteps.stepOrder);

  console.log(`   Found ${regionalSteps.length} regional workflow steps`);

  // -------------------------------------------------------------------------
  // Clean up any existing seed data for these scenarios
  // -------------------------------------------------------------------------
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const refPrefix = `GRN/TR/${now.getFullYear()}/${month}${day}/`;

  const existingReqs = await db
    .select({ id: transportRequests.id, reference: transportRequests.reference })
    .from(transportRequests)
    .where(and(eq(transportRequests.tenantId, TENANT_ID), sql`${transportRequests.reference} LIKE ${refPrefix + '%'}`));

  if (existingReqs.length > 0) {
    const reqIds = existingReqs.map((r) => r.id);
    console.log(`   Cleaning up ${existingReqs.length} previously seeded requests...`);

    // Delete in correct FK order to avoid cascade violations.
    // trips <-- vehicle_inspections (no cascade on trip_id)
    // trips <-- fuel_transactions (has cascade on trips)
    // trips <-- trip_closures (has cascade on trips)
    // trips <-- trip_progress_entries (has cascade on trips)
    // transport_requests <-- vehicle_allocations (has cascade)
    // transport_requests <-- trip_authorities (has cascade)
    // transport_requests <-- workflow_instances (no cascade? using requestId)

    const tripIds = (await db
      .select({ id: trips.id })
      .from(trips)
      .where(inArray(trips.requestId, reqIds)))
      .map((t) => t.id);

    if (tripIds.length > 0) {
      // Delete vehicle inspections first (they reference trips.id without cascade)
      // inspection_item_results cascade from vehicle_inspections
      await db.delete(vehicleInspections).where(inArray(vehicleInspections.tripId, tripIds));
      // Now trips can be safely deleted (closures, fuel, progress cascade)
      await db.delete(trips).where(inArray(trips.id, tripIds));
    }

    // Now transport request cascade handles allocations, authorities, workflow instances, etc.
    await db.delete(transportRequests).where(inArray(transportRequests.id, reqIds));
  }

  // -------------------------------------------------------------------------
  // SCENARIO 1: Fully completed regional trip — Community Development visit
  // -------------------------------------------------------------------------
  console.log('\n─── Scenario 1: Completed Regional Trip ───\n');

  const ref1 = `${refPrefix}101`;

  // 1a. Create transport request
  const [req1] = await db
    .insert(transportRequests)
    .values({
      tenantId: TENANT_ID,
      reference: ref1,
      scope: 'regional',
      status: 'closed',
      requesterEmployeeId: requester.id,
      requesterUserId: requester.userId,
      enteredByUserId: requester.userId,
      requestSource: 'logged_in_self_service',
      requestChannel: 'dashboard',
      submissionMethod: 'logged_in',
      verificationMethod: 'authenticated_session',
      department: 'Community Development',
      purpose: 'Rural community engagement visit to Ngangura, Shamvura, and Goma wa Goma settlements for needs assessment and project monitoring',
      specialAuthorityRequired: false,
      totalAuthorisedKilometres: 320,
      departmentId: requester.departmentId,
      submittedAt: new Date(now.getTime() - 14 * 86400000), // 14 days ago
    })
    .returning();
  console.log(`   Created Transport Request: ${ref1}`);

  // Activities
  await db.insert(requestActivities).values([
    { requestId: req1.id, title: 'Community engagement meeting', venue: 'Ngangura Village', startDate: new Date(now.getTime() - 12 * 86400000), endDate: new Date(now.getTime() - 12 * 86400000 + 3600000), estimatedKilometres: 80 },
    { requestId: req1.id, title: 'School infrastructure inspection', venue: 'Shamvura Combined School', startDate: new Date(now.getTime() - 12 * 86400000 + 7200000), endDate: new Date(now.getTime() - 12 * 86400000 + 14400000), estimatedKilometres: 120 },
    { requestId: req1.id, title: 'Water point assessment', venue: 'Goma wa Goma', startDate: new Date(now.getTime() - 11 * 86400000), endDate: new Date(now.getTime() - 11 * 86400000 + 7200000), estimatedKilometres: 120 },
  ]);

  // Routes
  await db.insert(requestRoutes).values([
    { requestId: req1.id, originName: 'Rundu', destinationName: 'Ngangura', totalKilometres: 80, isVerified: true },
    { requestId: req1.id, originName: 'Ngangura', destinationName: 'Shamvura', totalKilometres: 60, isVerified: true },
    { requestId: req1.id, originName: 'Shamvura', destinationName: 'Goma wa Goma', totalKilometres: 60, isVerified: true },
    { requestId: req1.id, originName: 'Goma wa Goma', destinationName: 'Rundu', totalKilometres: 120, isVerified: true },
  ]);

  // Passengers
  await db.insert(requestPassengers).values([
    { requestId: req1.id, employeeId: supervisor.id, travellerRole: 'team_lead', reasonForTravel: 'Project supervision', status: 'confirmed' },
    { requestId: req1.id, employeeId: empMap['KERC010']?.id || null, travellerRole: 'auditor', reasonForTravel: 'Field audit', status: 'confirmed' },
    { requestId: req1.id, externalName: 'Selma Nghifikwa', externalOrganisation: 'Ministry of Rural Development', travellerRole: 'observer', reasonForTravel: 'Policy compliance', status: 'confirmed' },
  ]);

  // Drivers
  await db.insert(requestDrivers).values([
    { requestId: req1.id, employeeId: driverEmp.id, driverType: 'nominated', sortOrder: 1 },
  ]);

  // 1b. Create workflow instance
  const [wfInstance1] = await db
    .insert(workflowInstances)
    .values({
      requestId: req1.id,
      definitionId: regionalWorkflow.id,
      definitionVersion: regionalWorkflow.version,
      currentStepOrder: 1,
      status: 'completed',
    })
    .returning();

  await db.update(transportRequests).set({ workflowInstanceId: wfInstance1.id }).where(eq(transportRequests.id, req1.id));

  // 1c. Workflow actions (all steps)
  await db.insert(workflowActions).values([
    { instanceId: wfInstance1.id, stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor.userId!, actorEmployeeId: supervisor.id, comment: 'Approved — priority community visit.', createdAt: new Date(now.getTime() - 13 * 86400000 + 3600000) },
    { instanceId: wfInstance1.id, stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin.userId!, actorEmployeeId: transportAdmin.id, comment: 'Vehicle available for the period.', createdAt: new Date(now.getTime() - 13 * 86400000 + 7200000) },
    { instanceId: wfInstance1.id, stepOrder: 3, actionType: 'release', result: 'released', actorUserId: releaseOff.userId!, actorEmployeeId: releaseOff.id, signatureRef: 'typed:Erastus Hausiku', createdAt: new Date(now.getTime() - 12 * 86400000 + 3600000) },
    { instanceId: wfInstance1.id, stepOrder: 4, actionType: 'authorise', result: 'authorised', actorUserId: authoriser.userId!, actorEmployeeId: authoriser.id, comment: 'Authorised for three days.', signatureRef: 'typed:Loide Kandjiri', createdAt: new Date(now.getTime() - 12 * 86400000 + 7200000) },
    { instanceId: wfInstance1.id, stepOrder: 5, actionType: 'acknowledge', result: 'acknowledged', actorUserId: driverEmp.userId!, actorEmployeeId: driverEmp.id, createdAt: new Date(now.getTime() - 11 * 86400000 + 5400000) },
  ]);

  // 1d. Create vehicle allocation
  const [alloc1] = await db
    .insert(vehicleAllocations)
    .values({
      requestId: req1.id,
      vehicleId: hiluxVehicle.id,
      driverEmployeeId: driverEmp.id,
      startAt: new Date(now.getTime() - 11 * 86400 * 1000),
      endAt: new Date(now.getTime() - 9 * 86400 * 1000),
      state: 'confirmed',
      allocatedByUserId: transportAdmin.userId!,
    })
    .returning();

  // 1e. Create trip
  const [trip1] = await db
    .insert(trips)
    .values({
      tenantId: TENANT_ID,
      requestId: req1.id,
      allocationId: alloc1.id,
      vehicleId: hiluxVehicle.id,
      status: 'closed',
      driverAcknowledgedAt: new Date(now.getTime() - 11 * 86400000 + 5400000),
      driverAcknowledgedByEmployeeId: driverEmp.id,
      issuedAt: new Date(now.getTime() - 11 * 86400000),
      startedAt: new Date(now.getTime() - 11 * 86400000 + 7200000),
      returnedAt: new Date(now.getTime() - 9 * 86400000 + 7200000),
      closedAt: new Date(now.getTime() - 8 * 86400000 + 10800000),
    })
    .returning();

  // 1f. Provision Trip Authority
  console.log('   Provisioning Trip Authority...');
  const authResult = await provisionTripAuthority({
    tripId: trip1.id,
    tenantId: TENANT_ID,
    requestId: req1.id,
    allocationId: alloc1.id,
    actorUserId: transportAdmin.userId!,
  });

  // Update authority statuses to reflect real journey
  await db.update(tripAuthorities)
    .set({
      status: 'closed',
      beginningOdometer: hiluxVehicle.currentOdometer || 18200,
      endingOdometer: (hiluxVehicle.currentOdometer || 18200) + 315,
      acceptedAt: new Date(now.getTime() - 11 * 86400000 + 5400000),
      acceptedByEmployeeId: driverEmp.id,
      authorisedAt: new Date(now.getTime() - 12 * 86400000 + 7200000),
    })
    .where(eq(tripAuthorities.id, authResult.authority.id));

  console.log(`   Trip Authority: ${authResult.authority.authorityNumber}`);

  // 1g. Departure inspection
  const [depInsp1] = await db
    .insert(vehicleInspections)
    .values({
      tenantId: TENANT_ID,
      vehicleId: hiluxVehicle.id,
      tripId: trip1.id,
      templateId: departureTemplate.id,
      templateVersion: departureTemplate.version,
      type: 'departure',
      odometerReading: hiluxVehicle.currentOdometer || 18200,
      fuelLevel: 'full',
      inspectorUserId: inspector.userId!,
      inspectorEmployeeId: inspector.id,
      driverEmployeeId: driverEmp.id,
      status: 'completed',
      overallPass: true,
      notes: 'Vehicle in good condition. Tyre pressures checked. All documentation in order.',
    })
    .returning();

  // Inspection item results — all pass
  for (let i = 0; i < Math.min(departItems.length, 16); i++) {
    await db.insert(inspectionItemResults).values({
      inspectionId: depInsp1.id,
      templateItemId: departItems[i].id,
      result: 'pass',
    });
  }

  await onInspectionCompleted(depInsp1.id, TENANT_ID, inspector.userId!);

  // 1h. Trip progress entries
  await db.insert(tripProgressEntries).values([
    { tenantId: TENANT_ID, tripId: trip1.id, entryType: 'departure', occurredAt: new Date(now.getTime() - 11 * 86400000 + 7200000), location: 'Rundu', odometerReading: hiluxVehicle.currentOdometer || 18200, note: 'Departed from Head Office', createdByUserId: driverEmp.userId! },
    { tenantId: TENANT_ID, tripId: trip1.id, entryType: 'waypoint', occurredAt: new Date(now.getTime() - 11 * 86400000 + 14400000), location: 'Ngangura', odometerReading: (hiluxVehicle.currentOdometer || 18200) + 80, note: 'Arrived at community meeting venue', createdByUserId: driverEmp.userId! },
    { tenantId: TENANT_ID, tripId: trip1.id, entryType: 'waypoint', occurredAt: new Date(now.getTime() - 10 * 86400000 + 3600000), location: 'Shamvura', odometerReading: (hiluxVehicle.currentOdometer || 18200) + 140, note: 'School inspection completed', createdByUserId: driverEmp.userId! },
    { tenantId: TENANT_ID, tripId: trip1.id, entryType: 'return', occurredAt: new Date(now.getTime() - 9 * 86400000 + 7200000), location: 'Rundu', odometerReading: (hiluxVehicle.currentOdometer || 18200) + 315, note: 'Returned to Head Office. Trip completed.', createdByUserId: driverEmp.userId! },
  ]);

  // 1i. Fuel transactions
  await db.insert(fuelTransactions).values([
    { tripId: trip1.id, vehicleId: hiluxVehicle.id, transactionAt: new Date(now.getTime() - 11 * 86400000 + 3600000), stationName: 'Engen Rundu', fuelType: 'diesel', litres: '60.00', amount: '792.00', paymentMethod: 'fuel_card', fillType: 'full', recordedByUserId: driverEmp.userId! },
    { tripId: trip1.id, vehicleId: hiluxVehicle.id, transactionAt: new Date(now.getTime() - 9 * 86400000 + 3600000), stationName: 'Total Shamvura', fuelType: 'diesel', litres: '45.00', amount: '594.00', paymentMethod: 'fuel_card', fillType: 'full', recordedByUserId: driverEmp.userId! },
  ]);

  // 1j. Trip closure
  await db.insert(tripClosures).values({
    tripId: trip1.id,
    authorisedKilometres: 320,
    actualKilometres: 315,
    kilometreVariance: -5,
    decision: 'approved',
    reviewNotes: 'Variance within acceptable tolerance (1.6%). Trip completed as planned. All objectives met.',
    closedByUserId: transportAdmin.userId!,
  });

  // 1k. Generate documents
  await onRequestSubmitted(req1.id, TENANT_ID, requester.userId!);
  await onTripClosed(trip1.id, TENANT_ID, transportAdmin.userId!);

  console.log(`   ✅ Scenario 1 complete: ${ref1} → ${authResult.authority.authorityNumber}`);

  // -------------------------------------------------------------------------
  // SCENARIO 2: Regional trip — In Progress (Sedan, different route)
  // -------------------------------------------------------------------------
  console.log('\n─── Scenario 2: In-Progress Regional Trip ───\n');

  const ref2 = `${refPrefix}102`;

  // Use driver2 as driver for this scenario (fallback to primary driver if unavailable)
  const scenario2Driver = hasDriver2 ? driver2 : driverEmp;

  const [req2] = await db
    .insert(transportRequests)
    .values({
      tenantId: TENANT_ID,
      reference: ref2,
      scope: 'regional',
      status: 'in_progress',
      requesterEmployeeId: empMap['KERC006']?.id || requester.id, // Tomas Sikongo (Director)
      requesterUserId: empMap['KERC006']?.userId,
      enteredByUserId: empMap['KERC006']?.userId,
      requestSource: 'logged_in_self_service',
      requestChannel: 'dashboard',
      submissionMethod: 'logged_in',
      verificationMethod: 'authenticated_session',
      department: 'Infrastructure and Planning',
      purpose: 'Field inspection of road upgrade projects in Mukwe and Mashare constituencies',
      specialAuthorityRequired: false,
      totalAuthorisedKilometres: 280,
      departmentId: empMap['KERC006']?.departmentId,
      submittedAt: new Date(now.getTime() - 5 * 86400000),
    })
    .returning();
  console.log(`   Created Transport Request: ${ref2}`);

  await db.insert(requestActivities).values([
    { requestId: req2.id, title: 'Road project site visit', venue: 'Mukwe Constituency', startDate: new Date(now.getTime() - 3 * 86400000), endDate: new Date(now.getTime() - 3 * 86400000 + 14400000), estimatedKilometres: 140 },
    { requestId: req2.id, title: 'Contractor coordination meeting', venue: 'Mashare Constituency Office', startDate: new Date(now.getTime() - 2 * 86400000), endDate: new Date(now.getTime() - 2 * 86400000 + 7200000), estimatedKilometres: 140 },
  ]);

  await db.insert(requestRoutes).values([
    { requestId: req2.id, originName: 'Rundu', destinationName: 'Mukwe', totalKilometres: 140, isVerified: true },
    { requestId: req2.id, originName: 'Mukwe', destinationName: 'Mashare', totalKilometres: 80, isVerified: true },
    { requestId: req2.id, originName: 'Mashare', destinationName: 'Rundu', totalKilometres: 60, isVerified: true },
  ]);

  await db.insert(requestPassengers).values([
    { requestId: req2.id, employeeId: empMap['KERC005']?.id, travellerRole: 'deputy_director', reasonForTravel: 'Programme oversight', status: 'confirmed' },
    { requestId: req2.id, externalName: 'John Mutumbula', externalOrganisation: 'Roads Authority Namibia', travellerRole: 'technical_advisor', reasonForTravel: 'Technical assessment', status: 'confirmed' },
  ]);

  await db.insert(requestDrivers).values([
    { requestId: req2.id, employeeId: scenario2Driver.id, driverType: 'nominated', sortOrder: 1 },
  ]);

  const [wfInstance2] = await db
    .insert(workflowInstances)
    .values({
      requestId: req2.id,
      definitionId: regionalWorkflow.id,
      definitionVersion: regionalWorkflow.version,
      currentStepOrder: 5,
      status: 'active',
    })
    .returning();

  await db.update(transportRequests).set({ workflowInstanceId: wfInstance2.id }).where(eq(transportRequests.id, req2.id));

  await db.insert(workflowActions).values([
    { instanceId: wfInstance2.id, stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor.userId!, actorEmployeeId: supervisor.id, createdAt: new Date(now.getTime() - 4 * 86400000 + 3600000) },
    { instanceId: wfInstance2.id, stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin.userId!, actorEmployeeId: transportAdmin.id, createdAt: new Date(now.getTime() - 4 * 86400000 + 7200000) },
    { instanceId: wfInstance2.id, stepOrder: 3, actionType: 'release', result: 'released', actorUserId: releaseOff.userId!, actorEmployeeId: releaseOff.id, signatureRef: 'typed:Erastus Hausiku', createdAt: new Date(now.getTime() - 3 * 86400000 + 3600000) },
    { instanceId: wfInstance2.id, stepOrder: 4, actionType: 'authorise', result: 'authorised', actorUserId: authoriser.userId!, actorEmployeeId: authoriser.id, signatureRef: 'typed:Loide Kandjiri', createdAt: new Date(now.getTime() - 3 * 86400000 + 7200000) },
  ]);

  const [alloc2] = await db
    .insert(vehicleAllocations)
    .values({
      requestId: req2.id,
      vehicleId: corollaVehicle.id,
      driverEmployeeId: scenario2Driver.id,
      startAt: new Date(now.getTime() - 2 * 86400 * 1000),
      endAt: new Date(now.getTime() + 86400 * 1000),
      state: 'confirmed',
      allocatedByUserId: transportAdmin.userId!,
    })
    .returning();

  const [trip2] = await db
    .insert(trips)
    .values({
      tenantId: TENANT_ID,
      requestId: req2.id,
      allocationId: alloc2.id,
      vehicleId: corollaVehicle.id,
      status: 'in_progress',
      driverAcknowledgedAt: new Date(now.getTime() - 2 * 86400000 + 3600000),
      driverAcknowledgedByEmployeeId: scenario2Driver.id,
      issuedAt: new Date(now.getTime() - 2 * 86400000),
      startedAt: new Date(now.getTime() - 2 * 86400000 + 7200000),
    })
    .returning();

  const authResult2 = await provisionTripAuthority({
    tripId: trip2.id,
    tenantId: TENANT_ID,
    requestId: req2.id,
    allocationId: alloc2.id,
    actorUserId: transportAdmin.userId!,
  });

  await db.update(tripAuthorities)
    .set({
      status: 'in_progress',
      beginningOdometer: corollaVehicle.currentOdometer || 45230,
      acceptedAt: new Date(now.getTime() - 2 * 86400000 + 3600000),
      acceptedByEmployeeId: scenario2Driver.id,
    })
    .where(eq(tripAuthorities.id, authResult2.authority.id));

  console.log(`   Trip Authority: ${authResult2.authority.authorityNumber}`);

  // Departure inspection
  const [depInsp2] = await db
    .insert(vehicleInspections)
    .values({
      tenantId: TENANT_ID,
      vehicleId: corollaVehicle.id,
      tripId: trip2.id,
      templateId: departureTemplate.id,
      templateVersion: departureTemplate.version,
      type: 'departure',
      odometerReading: corollaVehicle.currentOdometer || 45230,
      fuelLevel: 'full',
      inspectorUserId: inspector.userId!,
      inspectorEmployeeId: inspector.id,
      driverEmployeeId: scenario2Driver.id,
      status: 'completed',
      overallPass: true,
      notes: 'Routine check. All systems functional.',
    })
    .returning();

  for (let i = 0; i < Math.min(departItems.length, 14); i++) {
    await db.insert(inspectionItemResults).values({
      inspectionId: depInsp2.id,
      templateItemId: departItems[i].id,
      result: 'pass',
    });
  }

  await onInspectionCompleted(depInsp2.id, TENANT_ID, inspector.userId!);
  await onRequestSubmitted(req2.id, TENANT_ID, requester.userId!);

  console.log(`   ✅ Scenario 2 complete: ${ref2} → ${authResult2.authority.authorityNumber}`);

  // -------------------------------------------------------------------------
  // SCENARIO 3: National trip — Approved & Issued (pending driver acknowledgement)
  // -------------------------------------------------------------------------
  console.log('\n─── Scenario 3: National Trip (Issued) ───\n');

  const ref3 = `${refPrefix}103`;

  const [req3] = await db
    .insert(transportRequests)
    .values({
      tenantId: TENANT_ID,
      reference: ref3,
      scope: 'national',
      status: 'driver_acknowledgement_pending',
      requesterEmployeeId: authoriser.id,
      requesterUserId: authoriser.userId,
      enteredByUserId: authoriser.userId,
      requestSource: 'logged_in_self_service',
      requestChannel: 'dashboard',
      submissionMethod: 'logged_in',
      verificationMethod: 'authenticated_session',
      department: 'Office of the Chief Regional Officer',
      purpose: 'National delegation trip to Windhoek for inter-ministerial meeting on regional infrastructure funding and budget allocation',
      specialAuthorityRequired: false,
      totalAuthorisedKilometres: 750,
      departmentId: authoriser.departmentId,
      submittedAt: new Date(now.getTime() - 7 * 86400000),
    })
    .returning();
  console.log(`   Created Transport Request: ${ref3}`);

  await db.insert(requestActivities).values([
    { requestId: req3.id, title: 'Inter-ministerial infrastructure meeting', venue: 'Government Office Park, Windhoek', startDate: new Date(now.getTime() - 4 * 86400000), endDate: new Date(now.getTime() - 4 * 86400000 + 28800000), estimatedKilometres: 700 },
    { requestId: req3.id, title: 'Site visit — new regional office project', venue: 'Khomasdal, Windhoek', startDate: new Date(now.getTime() - 3 * 86400000), endDate: new Date(now.getTime() - 3 * 86400000 + 14400000), estimatedKilometres: 50 },
  ]);

  await db.insert(requestRoutes).values([
    { requestId: req3.id, originName: 'Rundu', destinationName: 'Windhoek', totalKilometres: 700, isVerified: true },
    { requestId: req3.id, originName: 'Windhoek', destinationName: 'Windhoek (Khomasdal)', totalKilometres: 15, isVerified: true },
    { requestId: req3.id, originName: 'Windhoek', destinationName: 'Rundu', totalKilometres: 50, isVerified: true },
  ]);

  await db.insert(requestPassengers).values([
    { requestId: req3.id, employeeId: empMap['KERC007']?.id || requester.id, travellerRole: 'lead', reasonForTravel: 'Principal delegate', status: 'confirmed' },
    { requestId: req3.id, externalName: 'Elizabeth Kambonde', externalOrganisation: 'Ministry of Finance', travellerRole: 'finance_officer', reasonForTravel: 'Budget coordination', status: 'confirmed' },
  ]);

  await db.insert(requestDrivers).values([
    { requestId: req3.id, employeeId: driverEmp.id, driverType: 'nominated', sortOrder: 1 },
  ]);

  // Create workflow instance — use national workflow
  const [wfInstance3] = await db
    .insert(workflowInstances)
    .values({
      requestId: req3.id,
      definitionId: nationalWorkflow.id,
      definitionVersion: nationalWorkflow.version,
      currentStepOrder: 5,
      status: 'active',
    })
    .returning();

  await db.update(transportRequests).set({ workflowInstanceId: wfInstance3.id }).where(eq(transportRequests.id, req3.id));

  // National workflow: supervisor_approve (1) → transport_review (2) → release (3) → national_release (4) → national_authorise (5) → acknowledge (6)
  // Currently at step 5 awaiting acknowledge
  const nat1 = empMap['KERC007']; // Rafael Kasume — Chief Regional Officer
  const nat2 = empMap['KERC006']; // Tomas Sikongo — Director

  await db.insert(workflowActions).values([
    { instanceId: wfInstance3.id, stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor.userId!, actorEmployeeId: supervisor.id, createdAt: new Date(now.getTime() - 6 * 86400000 + 3600000) },
    { instanceId: wfInstance3.id, stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin.userId!, actorEmployeeId: transportAdmin.id, createdAt: new Date(now.getTime() - 6 * 86400000 + 7200000) },
    { instanceId: wfInstance3.id, stepOrder: 3, actionType: 'release', result: 'released', actorUserId: releaseOff.userId!, actorEmployeeId: releaseOff.id, signatureRef: 'typed:Erastus Hausiku', createdAt: new Date(now.getTime() - 5 * 86400000 + 3600000) },
    { instanceId: wfInstance3.id, stepOrder: 4, actionType: 'release', result: 'released', actorUserId: nat2?.userId!, actorEmployeeId: nat2?.id, signatureRef: 'typed:Tomas Sikongo', createdAt: new Date(now.getTime() - 5 * 86400000 + 7200000) },
    { instanceId: wfInstance3.id, stepOrder: 5, actionType: 'authorise', result: 'authorised', actorUserId: nat1?.userId!, actorEmployeeId: nat1?.id, comment: 'Authorised for national delegation. Ensure travel itinerary is followed.', signatureRef: 'typed:Rafael Kasume', createdAt: new Date(now.getTime() - 4 * 86400000 + 3600000) },
  ]);

  const [alloc3] = await db
    .insert(vehicleAllocations)
    .values({
      requestId: req3.id,
      vehicleId: hiluxVehicle.id,
      driverEmployeeId: driverEmp.id,
      startAt: new Date(now.getTime() + 86400 * 1000),
      endAt: new Date(now.getTime() + 4 * 86400 * 1000),
      state: 'confirmed',
      allocatedByUserId: transportAdmin.userId!,
    })
    .returning();

  const [trip3] = await db
    .insert(trips)
    .values({
      tenantId: TENANT_ID,
      requestId: req3.id,
      allocationId: alloc3.id,
      vehicleId: hiluxVehicle.id,
      status: 'pending',
      issuedAt: new Date(now.getTime() - 2 * 86400000),
    })
    .returning();

  const authResult3 = await provisionTripAuthority({
    tripId: trip3.id,
    tenantId: TENANT_ID,
    requestId: req3.id,
    allocationId: alloc3.id,
    actorUserId: transportAdmin.userId!,
  });

  await db.update(tripAuthorities)
    .set({ status: 'awaiting_driver_acceptance', authorisedAt: new Date(now.getTime() - 4 * 86400000 + 3600000) })
    .where(eq(tripAuthorities.id, authResult3.authority.id));

  await onRequestSubmitted(req3.id, TENANT_ID, requester.userId!);

  console.log(`   Trip Authority: ${authResult3.authority.authorityNumber}`);
  console.log(`   ✅ Scenario 3 complete: ${ref3} → ${authResult3.authority.authorityNumber}`);

  // -------------------------------------------------------------------------
  // SCENARIO 4: A maintenance report for the Toyota Hilux
  // -------------------------------------------------------------------------
  console.log('\n─── Scenario 4: Maintenance Record ───\n');

  const maintenanceAdmin = empMap['KERC013']; // Hilma Nakashole
  if (!maintenanceAdmin?.userId) {
    console.error('❌ Maintenance officer has no linked auth user. Run pnpm db:seed first.');
    process.exit(1);
  }

  await db
    .insert(maintenanceEvents)
    .values([
      { vehicleId: hiluxVehicle.id, serviceDate: new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0], serviceOdometer: 12000, serviceType: 'scheduled', description: '15,000 km scheduled service — oil change, filter replacement, brake inspection', cost: '2450.00', vendorName: 'Toyota Windhoek', nextServiceDate: new Date(now.getTime() + 90 * 86400000).toISOString().split('T')[0], nextServiceOdometer: 28000, createdByUserId: maintenanceAdmin.userId },
      { vehicleId: hiluxVehicle.id, serviceDate: new Date(now.getTime() - 45 * 86400000).toISOString().split('T')[0], serviceOdometer: 15500, serviceType: 'repair', description: 'Replace front brake pads and resurface discs — worn due to gravel road use', cost: '1875.50', vendorName: 'AutoZone Rundu', createdByUserId: maintenanceAdmin.userId },
      { vehicleId: hiluxVehicle.id, serviceDate: new Date(now.getTime() - 10 * 86400000).toISOString().split('T')[0], serviceOdometer: 18100, serviceType: 'inspection', description: 'Pre-trip safety inspection — all systems functional, minor tightening of suspension components', cost: '450.00', vendorName: 'Council Workshop, Rundu', createdByUserId: maintenanceAdmin.userId },
      { vehicleId: corollaVehicle.id, serviceDate: new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0], serviceOdometer: 43000, serviceType: 'scheduled', description: '45,000 km service — oil change, spark plugs, air filter, wheel alignment', cost: '3200.00', vendorName: 'Nissan Windhoek', nextServiceDate: new Date(now.getTime() + 60 * 86400000).toISOString().split('T')[0], nextServiceOdometer: 55000, createdByUserId: maintenanceAdmin.userId },
    ]);
  console.log('   Created 4 maintenance events');

  // Generate maintenance report document
  await generateDocument({
    documentType: 'maintenance_report',
    entityType: 'maintenance',
    entityId: hiluxVehicle.id,
    tenantId: TENANT_ID,
    generatedByUserId: maintenanceAdmin.userId,
  });

  // Generate vehicle history
  await generateDocument({
    documentType: 'vehicle_history',
    entityType: 'vehicle',
    entityId: hiluxVehicle.id,
    tenantId: TENANT_ID,
    generatedByUserId: maintenanceAdmin.userId,
  });

  console.log('   ✅ Scenario 4 complete: Maintenance documents generated');

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n✅ Document seed complete!');
  console.log('\n   New documents created:');
  console.log('   • Transport Requests: 3');
  console.log('     - Scenario 1: Completed regional trip (closed)');
  console.log('     - Scenario 2: Active in-progress trip');
  console.log('     - Scenario 3: National trip awaiting driver acknowledgement');
  console.log('   • Trip Authorities: 3');
  console.log('   • Vehicle Inspections: 2 (departure)');
  console.log('   • Fuel Transactions: 2');
  console.log('   • Trip Progress Entries: 8');
  console.log('   • Maintenance Events: 4');
  console.log('   • Generated documents: transport_request, trip_authority,');
  console.log('     fuel_summary, trip_completion, inspection_report,');
  console.log('     maintenance_report, vehicle_history');
  console.log('\n   Login and navigate to /dashboard/documents to see all documents.');
  console.log('   Filter by type (transport_request, trip_authority) for specific views.\n');
}

seedDocuments()
  .catch((e: unknown) => {
    console.error('❌ Document seed failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
