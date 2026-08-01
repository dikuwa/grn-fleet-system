/**
 * Approval Workflow Seed
 *
 * Creates pending transport requests at every workflow stage so each
 * approval / releasing / authorising role has visible items in their queue.
 *
 * Run AFTER `pnpm db:seed` and `npx tsx src/seed/seed-documents.ts`:
 *   npx tsx src/seed/seed-approval-workflow.ts
 */
import { getDb } from '@/db';
import { user } from '@/db/schema';
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
} from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import {
  workflowDefinitions,
  workflowInstances,
  workflowActions,
} from '@/db/schema/workflows';
import { notifications } from '@/db/schema/notifications';

import { eq, and, sql, inArray } from 'drizzle-orm';


const TENANT_ID = '00000000-0000-0000-0000-000000000001';

interface Employee {
  id: string;
  empNo: string;
  firstName: string;
  lastName: string;
  userId: string | null;
  jobTitle: string | null;
  departmentId: string | null;
}

interface UserWithProfile {
  id: string;
  email: string;
  name: string | null;
}

async function seedApprovalWorkflow() {
  const db = getDb();
  console.log('🔧 Seeding approval workflow test data...\n');

  // -------------------------------------------------------------------------
  // 1. Look up identities
  // -------------------------------------------------------------------------
  console.log('Looking up identities...');

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

  const empMap: Record<string, Employee> = {};
  for (const e of allEmployees) {
    empMap[e.empNo] = e;
  }

  const requester = empMap['KERC002']; // Maria Shikongo
  const supervisor = empMap['KERC003']; // Petrus Ndara
  const controlAdmin = empMap['KERC004']; // Erastus Hausiku
  const regionalAuthoriser = empMap['KERC005']; // Loide Kandjiri
  const director = empMap['KERC006']; // Tomas Sikongo
  const cro = empMap['KERC007']; // Rafael Kasume
  const driver1 = empMap['KERC008']; // Michael Mwala
  const driver2 = empMap['KERC009']; // Selma Nangula
  const transportAdmin = empMap['KERC011']; // Ndapewa Hamutenya

  const requiredEmps = [requester, supervisor, controlAdmin, regionalAuthoriser, director, cro, driver1, transportAdmin];
  for (const emp of requiredEmps) {
    if (!emp?.userId) {
      console.error(`❌ ${emp?.firstName} ${emp?.lastName} (${emp?.empNo}) has no linked auth user. Run pnpm db:seed first.`);
      process.exit(1);
    }
  }

  // Look up auth users
  const allUsers = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, requiredEmps.map((e) => e!.userId!).filter(Boolean)));

  const userMap: Record<string, UserWithProfile> = {};
  for (const u of allUsers) {
    userMap[u.id] = u;
  }

  // Vehicles
  const allVehicles = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.tenantId, TENANT_ID), eq(vehicles.isActive, true)));

  const hilux = allVehicles.find((v) => v.licenceNumber === 'GRN-003-2024');
  const corolla = allVehicles.find((v) => v.licenceNumber === 'GRN-001-2024');
  const sentra = allVehicles.find((v) => v.licenceNumber === 'GRN-002-2024');

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

  const now = new Date();
  const refPrefix = `GRN/AW/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}/`;

  console.log(`   ${Object.keys(empMap).length} employees, ${allVehicles.length} vehicles, 2 workflows found\n`);

  // -------------------------------------------------------------------------
  // Helper: create a transport request at a specific workflow stage
  // -------------------------------------------------------------------------
  let seq = 0;

  async function createRequestAtStage(opts: {
    reference: string;
    scope: 'regional' | 'national';
    purpose: string;
    requesterEmp: Employee;
    driverEmp: Employee;
    department: string;
    currentStepOrder: number;
    definitionId: string;
    completedActions: Array<{
      stepOrder: number;
      actionType: string;
      result: string;
      actorUserId: string;
      actorEmployeeId: string;
      comment?: string;
      signatureRef?: string;
    }>;
    numPassengers?: number;
    useVehicleId?: string;
    pendingForLabel?: string;
    destination?: string;
  }) {
    seq++;
    const reqRef = opts.reference;

    // Create transport request
    const [req] = await db
      .insert(transportRequests)
      .values({
        tenantId: TENANT_ID,
        reference: reqRef,
        scope: opts.scope,
        status: 'submitted',
        requesterEmployeeId: opts.requesterEmp.id,
        requesterUserId: opts.requesterEmp.userId,
        enteredByUserId: opts.requesterEmp.userId,
        requestSource: 'logged_in_self_service',
        requestChannel: 'dashboard',
        submissionMethod: 'logged_in',
        verificationMethod: 'authenticated_session',
        department: opts.department,
        purpose: opts.purpose,
        specialAuthorityRequired: false,
        totalAuthorisedKilometres: opts.scope === 'national' ? 750 : 250,
        departmentId: opts.requesterEmp.departmentId,
        submittedAt: new Date(now.getTime() - (10 - seq) * 3600000),
      })
      .returning();

    // Activities
    const dest = opts.destination || (opts.scope === 'national' ? 'Windhoek' : 'Mukwe');
    await db.insert(requestActivities).values([
      { requestId: req.id, title: 'Field visit', venue: dest, startDate: new Date(now.getTime() + 7 * 86400000), endDate: new Date(now.getTime() + 7 * 86400000 + 14400000), estimatedKilometres: opts.scope === 'national' ? 700 : 200 },
      { requestId: req.id, title: 'Follow-up meeting', venue: `${dest} Office`, startDate: new Date(now.getTime() + 8 * 86400000), endDate: new Date(now.getTime() + 8 * 86400000 + 7200000), estimatedKilometres: 50 },
    ]);

    // Routes
    const origin = 'Rundu';
    await db.insert(requestRoutes).values([
      { requestId: req.id, originName: origin, destinationName: dest, totalKilometres: opts.scope === 'national' ? 700 : 140, isVerified: true },
      { requestId: req.id, originName: dest, destinationName: origin, totalKilometres: opts.scope === 'national' ? 700 : 140, isVerified: true },
    ]);

    // Passengers
    const passengerEmps = opts.numPassengers
      ? [opts.requesterEmp, ...(opts.numPassengers > 1 ? [empMap['KERC010'] as Employee].filter(Boolean) : [])]
      : [opts.requesterEmp];

    for (let i = 0; i < Math.min(passengerEmps.length, 3); i++) {
      const pe = passengerEmps[i];
      if (pe) {
        await db.insert(requestPassengers).values({
          requestId: req.id,
          employeeId: pe.id,
          travellerRole: i === 0 ? 'lead' : 'support',
          reasonForTravel: opts.purpose,
          status: 'confirmed',
        });
      }
    }

    // External passenger
    if (opts.scope === 'national') {
      await db.insert(requestPassengers).values({
        requestId: req.id,
        externalName: 'Delegation Member',
        externalOrganisation: 'Ministry of Works',
        travellerRole: 'observer',
        reasonForTravel: 'Policy coordination',
        status: 'confirmed',
      });
    }

    // Driver
    await db.insert(requestDrivers).values([
      { requestId: req.id, employeeId: opts.driverEmp.id, driverType: 'nominated', sortOrder: 1 },
    ]);

    // Create workflow instance
    const [wfInstance] = await db
      .insert(workflowInstances)
      .values({
        requestId: req.id,
        definitionId: opts.definitionId,
        definitionVersion: 1,
        currentStepOrder: opts.currentStepOrder,
        status: opts.currentStepOrder > 5 ? 'completed' : 'active',
      })
      .returning();

    await db.update(transportRequests).set({ workflowInstanceId: wfInstance.id }).where(eq(transportRequests.id, req.id));

    // Completed actions
    for (const action of opts.completedActions) {
      await db.insert(workflowActions).values({
        instanceId: wfInstance.id,
        stepOrder: action.stepOrder,
        actionType: action.actionType,
        result: action.result,
        actorUserId: action.actorUserId,
        actorEmployeeId: action.actorEmployeeId,
        comment: action.comment || null,
        signatureRef: action.signatureRef || null,
        createdAt: new Date(now.getTime() - (10 - seq) * 3600000 + action.stepOrder * 3600000),
      });
    }

    // Update request status to match workflow
    const statusLabels: Record<number, string> = {
      1: 'supervisor_review',
      2: 'transport_review',
      3: 'release_pending',
      4: opts.scope === 'regional' ? 'administratively_released' : 'vehicle_allocated',
      5: opts.scope === 'regional' ? 'driver_acknowledgement_pending' : 'final_authorisation_pending',
      6: 'driver_acknowledgement_pending',
    };

    const newStatus = opts.completedActions.length === 0
      ? 'submitted'
      : opts.completedActions.some((a) => a.result === 'rejected' || a.result === 'returned')
        ? opts.completedActions.find((a) => a.result === 'rejected') ? 'rejected' : 'returned'
        : statusLabels[opts.currentStepOrder] || 'approved';

    await db.update(transportRequests).set({ status: newStatus, updatedAt: new Date() }).where(eq(transportRequests.id, req.id));

    // Vehicle allocation for steps >= 3
    if (opts.currentStepOrder >= 3 && opts.useVehicleId) {
      const [alloc] = await db
        .insert(vehicleAllocations)
        .values({
          requestId: req.id,
          vehicleId: opts.useVehicleId,
          driverEmployeeId: opts.driverEmp.id,
          startAt: new Date(now.getTime() + (7 + seq * 5) * 86400000),
          endAt: new Date(now.getTime() + (9 + seq * 5) * 86400000),
          state: 'confirmed',
          allocatedByUserId: transportAdmin!.userId!,
        })
        .returning();

      const [trip] = await db
        .insert(trips)
        .values({
          tenantId: TENANT_ID,
          requestId: req.id,
          allocationId: alloc.id,
          vehicleId: opts.useVehicleId,
          status: 'pending',
          issuedAt: new Date(now.getTime() - (10 - seq) * 3600000 + 7200000),
        })
        .returning();

      // Trip authority for steps >= 4
      if (opts.currentStepOrder >= 4) {
        await db.insert(tripAuthorities).values({
          requestId: req.id,
          allocationId: alloc.id,
          tripId: trip.id,
          tenantId: TENANT_ID,
          authorityNumber: `AW-${String(seq).padStart(4, '0')}`,
          status: opts.currentStepOrder >= 5 ? 'awaiting_driver_acceptance' : 'issued',
          issuedAt: new Date(now.getTime() - (10 - seq) * 3600000 + 7200000),
          authorisedAt: opts.currentStepOrder >= 5 ? new Date(now.getTime() - (10 - seq) * 3600000 + 10800000) : null,
        });
      }
    }

    console.log(`   ✅ ${reqRef} — ${opts.pendingForLabel || `Step ${opts.currentStepOrder}`} (${newStatus})`);

    // Create notification for the current step assignee
    if (opts.currentStepOrder <= 5) {
      const nextStepAction = opts.completedActions.length;
      const stepActions = [
        { label: 'Supervisor Approval', assigneeUserId: supervisor!.userId! },
        { label: 'Transport Review', assigneeUserId: transportAdmin!.userId! },
        { label: 'Administrative Release', assigneeUserId: controlAdmin!.userId! },
        { label: 'Director Release (National)', assigneeUserId: director!.userId! },
        { label: 'CRO Authorisation (National)', assigneeUserId: cro!.userId! },
      ];

      if (nextStepAction < stepActions.length) {
        const s = stepActions[nextStepAction];
        await db.insert(notifications).values({
          tenantId: TENANT_ID,
          recipientUserId: s.assigneeUserId,
          audience: 'user',
          type: 'action_required',
          title: `Action Required — ${s.label}`,
          body: `Transport request ${reqRef} is awaiting your ${s.label.toLowerCase()} action.`,
          entityType: 'workflow_instance',
          entityId: wfInstance.id,
          actionUrl: `/dashboard/approvals/${wfInstance.id}`,
          priority: 'high',
        });
      }
    }

    return { request: req, workflowInstance: wfInstance };
  }

  // -------------------------------------------------------------------------
  // Clean up any previously seeded approval workflow requests
  // -------------------------------------------------------------------------
  const existingReqs = await db
    .select({ id: transportRequests.id, reference: transportRequests.reference })
    .from(transportRequests)
    .where(and(eq(transportRequests.tenantId, TENANT_ID), sql`${transportRequests.reference} LIKE ${'GRN/AW/%'}`));

  if (existingReqs.length > 0) {
    console.log(`   Cleaning up ${existingReqs.length} previously seeded approval workflow requests...`);
    const reqIds = existingReqs.map((r) => r.id);
    const tripIds = (await db.select({ id: trips.id }).from(trips).where(inArray(trips.requestId, reqIds))).map((t) => t.id);
    if (tripIds.length > 0) {
      await db.delete(tripAuthorities).where(inArray(tripAuthorities.tripId, tripIds));
      await db.delete(trips).where(inArray(trips.id, tripIds));
    }
    await db.delete(transportRequests).where(inArray(transportRequests.id, reqIds));
    console.log('   Cleanup complete.\n');
  }

  // -------------------------------------------------------------------------
  // 2. Create pending requests at every stage
  // -------------------------------------------------------------------------
  console.log('\n─── Creating pending approval workflow requests ───\n');

  // --- REGIONAL TRIPS ---

  // REQ-SUP-001: Awaiting Immediate Supervisor approval (Step 1)
  await createRequestAtStage({
    reference: `${refPrefix}SUP-01`,
    scope: 'regional',
    purpose: 'Community outreach programme in Rundu Rural West constituency',
    requesterEmp: requester!,
    driverEmp: driver1!,
    department: 'Community Development',
    currentStepOrder: 1,
    definitionId: regionalWorkflow.id,
    completedActions: [],
    pendingForLabel: 'Awaiting Immediate Supervisor',
    destination: 'Rundu Rural West',
  });

  // REQ-SUP-002: Awaiting Immediate Supervisor approval (Step 1)
  await createRequestAtStage({
    reference: `${refPrefix}SUP-02`,
    scope: 'regional',
    purpose: 'Water point monitoring visit to Kapako constituency',
    requesterEmp: empMap['KERC010'] || requester!,
    driverEmp: driver2!,
    department: 'Community Development',
    currentStepOrder: 1,
    definitionId: regionalWorkflow.id,
    completedActions: [],
    pendingForLabel: 'Awaiting Immediate Supervisor',
    destination: 'Kapako',
  });

  // REQ-CAO-001: Awaiting Control Administrative Officer (Step 2)
  await createRequestAtStage({
    reference: `${refPrefix}CAO-01`,
    scope: 'regional',
    purpose: 'School sports equipment delivery to Mashare',
    requesterEmp: requester!,
    driverEmp: driver1!,
    department: 'Community Development',
    currentStepOrder: 2,
    definitionId: regionalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved — priority delivery.' },
    ],
    pendingForLabel: 'Awaiting Control Admin Officer',
    destination: 'Mashare',
  });

  // REQ-CAO-002: Awaiting Control Administrative Officer (Step 2)
  await createRequestAtStage({
    reference: `${refPrefix}CAO-02`,
    scope: 'regional',
    purpose: 'Field audit of constituency office assets',
    requesterEmp: empMap['KERC010'] || requester!,
    driverEmp: driver2!,
    department: 'Administration and Finance',
    currentStepOrder: 2,
    definitionId: regionalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved for audit.' },
    ],
    pendingForLabel: 'Awaiting Control Admin Officer',
    destination: 'Mukwe',
  });

  // REQ-RA-001: Awaiting Regional Authoriser (Step 3) - actually step 4 in workflow (authorise)
  await createRequestAtStage({
    reference: `${refPrefix}RA-01`,
    scope: 'regional',
    purpose: 'Infrastructure project site inspection in Nkurenkuru',
    requesterEmp: requester!,
    driverEmp: driver1!,
    department: 'Infrastructure and Planning',
    currentStepOrder: 4,
    definitionId: regionalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Vehicle available.' },
      { stepOrder: 3, actionType: 'release', result: 'released', actorUserId: controlAdmin!.userId!, actorEmployeeId: controlAdmin!.id, signatureRef: 'typed:Erastus Hausiku' },
    ],
    pendingForLabel: 'Awaiting Regional Authoriser (Deputy Director)',
    useVehicleId: corolla?.id,
    destination: 'Nkurenkuru',
  });

  // REQ-RA-002: Awaiting Regional Authoriser (Step 4) 
  await createRequestAtStage({
    reference: `${refPrefix}RA-02`,
    scope: 'regional',
    purpose: 'Community health outreach programme coordination',
    requesterEmp: requester!,
    driverEmp: driver1!,
    department: 'Community Development',
    currentStepOrder: 4,
    definitionId: regionalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Vehicle allocated.' },
      { stepOrder: 3, actionType: 'release', result: 'released', actorUserId: controlAdmin!.userId!, actorEmployeeId: controlAdmin!.id, signatureRef: 'typed:Erastus Hausiku' },
    ],
    pendingForLabel: 'Awaiting Regional Authoriser (Deputy Director)',
    useVehicleId: sentra?.id,
    destination: 'Mashare',
  });

  // REQ-DDRR-001: Awaiting Deputy Director Regional Release (Step 3 - release)
  await createRequestAtStage({
    reference: `${refPrefix}DDRR-01`,
    scope: 'regional',
    purpose: 'Regional stakeholder engagement workshop',
    requesterEmp: requester!,
    driverEmp: driver1!,
    department: 'Community Development',
    currentStepOrder: 3,
    definitionId: regionalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved — workshop key deliverable.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Vehicle confirmed.' },
    ],
    pendingForLabel: 'Awaiting Deputy Director Regional Release',
    useVehicleId: hilux?.id,
    destination: 'Rundu Rural East',
  });

  // REQ-DDRR-002: Awaiting Deputy Director Regional Release (Step 3)
  await createRequestAtStage({
    reference: `${refPrefix}DDRR-02`,
    scope: 'regional',
    purpose: 'Emergency food relief distribution coordination',
    requesterEmp: requester!,
    driverEmp: driver2!,
    department: 'Administration and Finance',
    currentStepOrder: 3,
    definitionId: regionalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Urgent — approved.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Coordinating with disaster response.' },
    ],
    pendingForLabel: 'Awaiting Deputy Director Regional Release',
    useVehicleId: hilux?.id,
    destination: 'Mukwe',
  });

  // --- NATIONAL TRIPS ---

  // REQ-CRO-001: Awaiting CRO National Authorisation (National step 4)
  await createRequestAtStage({
    reference: `${refPrefix}CRO-01`,
    scope: 'national',
    purpose: 'National delegation to Ministry of Finance budget hearings',
    requesterEmp: cro!,
    driverEmp: driver1!,
    department: 'Office of the Chief Regional Officer',
    currentStepOrder: 4,
    definitionId: nationalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Vehicle and driver confirmed for national trip.' },
      { stepOrder: 3, actionType: 'release', result: 'released', actorUserId: director!.userId!, actorEmployeeId: director!.id, signatureRef: 'typed:Tomas Sikongo' },
    ],
    pendingForLabel: 'Awaiting CRO National Authorisation',
    useVehicleId: hilux?.id,
    destination: 'Windhoek',
  });

  // REQ-CRO-002: Awaiting CRO National Authorisation (National step 4)
  await createRequestAtStage({
    reference: `${refPrefix}CRO-02`,
    scope: 'national',
    purpose: 'Inter-regional cooperation meeting with Ministry of Works',
    requesterEmp: cro!,
    driverEmp: driver1!,
    department: 'Office of the Chief Regional Officer',
    currentStepOrder: 4,
    definitionId: nationalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Endorsed.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Allocated.' },
      { stepOrder: 3, actionType: 'release', result: 'released', actorUserId: director!.userId!, actorEmployeeId: director!.id, signatureRef: 'typed:Tomas Sikongo' },
    ],
    pendingForLabel: 'Awaiting CRO National Authorisation (Emergency Eligible)',
    useVehicleId: hilux?.id,
    destination: 'Windhoek',
  });

  // REQ-CRO-003: Emergency National Trip - Awaiting CRO Decision (National step 4)
  await createRequestAtStage({
    reference: `${refPrefix}CRO-03`,
    scope: 'national',
    purpose: 'URGENT: Emergency response coordination — flood relief assessment in northern regions',
    requesterEmp: cro!,
    driverEmp: driver1!,
    department: 'Office of the Chief Regional Officer',
    currentStepOrder: 4,
    definitionId: nationalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Emergency — fast-track approval.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Expedited — vehicle on standby.' },
      { stepOrder: 3, actionType: 'release', result: 'released', actorUserId: director!.userId!, actorEmployeeId: director!.id, signatureRef: 'typed:Tomas Sikongo' },
    ],
    pendingForLabel: 'Awaiting CRO Decision — Emergency Eligible',
    useVehicleId: hilux?.id,
    destination: 'Omusati / Ohangwena',
  });

  // REQ-DNR-001: Awaiting Director National Release (National step 3)
  await createRequestAtStage({
    reference: `${refPrefix}DNR-01`,
    scope: 'national',
    purpose: 'National procurement review meeting — Ministry of Industrialisation',
    requesterEmp: requester!,
    driverEmp: driver1!,
    department: 'Administration and Finance',
    currentStepOrder: 3,
    definitionId: nationalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'National vehicle requisition processed.' },
    ],
    pendingForLabel: 'Awaiting Director National Release',
    useVehicleId: hilux?.id,
    destination: 'Windhoek',
  });

  // REQ-DNR-002: Awaiting Director National Release (National step 3)
  await createRequestAtStage({
    reference: `${refPrefix}DNR-02`,
    scope: 'national',
    purpose: 'Senior staff training and development workshop — Public Service Commission',
    requesterEmp: empMap['KERC005'] || requester!,
    driverEmp: driver1!,
    department: 'Administration and Finance',
    currentStepOrder: 3,
    definitionId: nationalWorkflow.id,
    completedActions: [
      { stepOrder: 1, actionType: 'supervisor_approve', result: 'approved', actorUserId: supervisor!.userId!, actorEmployeeId: supervisor!.id, comment: 'Approved — staff development priority.' },
      { stepOrder: 2, actionType: 'transport_review', result: 'approved', actorUserId: transportAdmin!.userId!, actorEmployeeId: transportAdmin!.id, comment: 'Vehicle reserved.' },
    ],
    pendingForLabel: 'Awaiting Director National Release',
    useVehicleId: corolla?.id,
    destination: 'Windhoek',
  });

  // -------------------------------------------------------------------------
  // Print pending summary
  // -------------------------------------------------------------------------
  console.log('\n─── Pending Requests Summary ───\n');
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│ Reference         │ Stage                                            │');
  console.log('├─────────────────────────────────────────────────────────────────────┤');
  const pendingItems = [
    { ref: `${refPrefix}SUP-01`, stage: 'Awaiting Immediate Supervisor' },
    { ref: `${refPrefix}SUP-02`, stage: 'Awaiting Immediate Supervisor' },
    { ref: `${refPrefix}CAO-01`, stage: 'Awaiting Control Administrative Officer' },
    { ref: `${refPrefix}CAO-02`, stage: 'Awaiting Control Administrative Officer' },
    { ref: `${refPrefix}RA-01`,  stage: 'Awaiting Regional Authoriser (Deputy Director)' },
    { ref: `${refPrefix}RA-02`,  stage: 'Awaiting Regional Authoriser (Deputy Director)' },
    { ref: `${refPrefix}DDRR-01`, stage: 'Awaiting Deputy Director Regional Release' },
    { ref: `${refPrefix}DDRR-02`, stage: 'Awaiting Deputy Director Regional Release' },
    { ref: `${refPrefix}CRO-01`, stage: 'Awaiting CRO National Authorisation' },
    { ref: `${refPrefix}CRO-02`, stage: 'Awaiting CRO National Authorisation' },
    { ref: `${refPrefix}CRO-03`, stage: 'Awaiting CRO Decision — Emergency Eligible' },
    { ref: `${refPrefix}DNR-01`, stage: 'Awaiting Director National Release' },
    { ref: `${refPrefix}DNR-02`, stage: 'Awaiting Director National Release' },
  ];

  for (const item of pendingItems) {
    console.log(`│ ${item.ref.padEnd(18)}│ ${item.stage.padEnd(48)}│`);
  }
  console.log('└─────────────────────────────────────────────────────────────────────┘');

  console.log('\n✅ Approval workflow seed complete!');
  console.log('   Pending requests: 13 (2 per role + 1 emergency for CRO)');
  console.log('   Login accounts:');
  console.log('     supervisor@kavangoeast.test          — Immediate Supervisor');
  console.log('     release.officer@kavangoeast.test     — Control Administrative Officer');
  console.log('     regional.authoriser@kavangoeast.test — Regional Authoriser (Deputy Director)');
  console.log('     national.authoriser@kavangoeast.test  — Chief Regional Officer');
  console.log('     national.release@kavangoeast.test     — Director (National Release)');
  console.log('\n   All passwords: changeme\n');
}

seedApprovalWorkflow()
  .catch((e: unknown) => {
    console.error('❌ Approval workflow seed failed:', e);
    process.exit(1);
  })
  .then(() => process.exit(0));
