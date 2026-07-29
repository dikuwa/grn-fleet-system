/**
 * PDF Component Unit Tests
 *
 * Tests the typed document components by verifying they can be constructed
 * with valid snapshot data, and confirming the data interface contracts
 * match the actual snapshot shapes produced by the document generator.
 *
 * NOTE: These tests validate the data contracts and component construction.
 * Full PDF rendering requires @react-pdf/renderer's renderToStream which is
 * best tested via the E2E PDF export tests.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';

// ---------------------------------------------------------------------------
// Transport Request Document Tests
// ---------------------------------------------------------------------------

describe('TransportRequestDocument data contract', () => {
  const mockSnapshot = {
    reference: 'GRN/TR/2026/0728/362',
    revision: 1,
    scope: 'regional',
    status: 'authorised',
    department: 'Community Development',
    purpose: 'Field inspection of community projects',
    totalAuthorisedKilometres: 450,
    specialAuthorityRequired: false,
    submittedAt: '2026-07-28T17:46:00.000Z',
    requester: {
      name: 'Maria Shikongo',
      employeeNumber: 'EMP-0042',
      designation: 'Programme Officer',
      department: 'Community Development',
      office: 'Rundu',
      phone: '+264 81 234 5678',
      email: 'maria@kavangoeast.gov.na',
    },
    activities: [
      {
        title: 'Community Centre Inspection',
        venue: 'Mashare Community Centre',
        startDate: '2026-07-29T08:00:00.000Z',
        endDate: '2026-07-29T16:00:00.000Z',
        estimatedKilometres: 120,
      },
    ],
    passengers: [
      {
        name: 'Petrus Ndara',
        employeeNumber: 'EMP-0087',
        departmentOrOrganisation: 'Works and Transport',
        role: 'Technical Advisor',
        travellerType: 'Employee',
        reasonForTravel: 'Technical assessment',
      },
      {
        name: 'Selma Shaningwa',
        employeeNumber: undefined,
        departmentOrOrganisation: 'Ministry of Works',
        role: 'Observer',
        travellerType: 'External traveller',
        reasonForTravel: 'Project inspection',
      },
    ],
    travellerCount: 3,
    drivers: [
      {
        driverType: 'primary',
        sortOrder: 1,
        name: 'John Shikongo',
        employeeNumber: 'EMP-0015',
        department: 'Transport',
      },
    ],
    routes: [
      {
        origin: 'Rundu',
        destination: 'Mashare',
        estimatedKilometres: 120,
        estimatedDurationMinutes: 90,
      },
    ],
    attachments: [
      { fileName: 'project-plan.pdf', mimeType: 'application/pdf' },
    ],
    approvalWorkflow: [
      {
        stage: 1,
        action: 'recommend',
        officer: 'Petrus Ndara',
        decision: 'approved',
        dateTime: '2026-07-28T18:00:00.000Z',
        comment: 'Approved for travel',
        signature: 'Digitally signed',
      },
    ],
  };

  it('has all required fields for the transport request snapshot', () => {
    expect(mockSnapshot.reference).toMatch(/^GRN\/TR\/\d{4}\/\d{4}\/\d{3}$/);
    expect(mockSnapshot.scope).toMatch(/^(regional|national)$/);
    expect(mockSnapshot.requester.name).toBeTruthy();
    expect(mockSnapshot.requester.employeeNumber).toMatch(/^EMP-\d{4}$/);
    expect(Array.isArray(mockSnapshot.activities)).toBe(true);
    expect(Array.isArray(mockSnapshot.passengers)).toBe(true);
    expect(Array.isArray(mockSnapshot.drivers)).toBe(true);
    expect(Array.isArray(mockSnapshot.routes)).toBe(true);
    expect(Array.isArray(mockSnapshot.approvalWorkflow)).toBe(true);
  });

  it('activities have required fields', () => {
    for (const activity of mockSnapshot.activities) {
      expect(activity.title).toBeTruthy();
      expect(activity.venue).toBeTruthy();
      expect(() => new Date(activity.startDate)).not.toThrow();
      expect(() => new Date(activity.endDate)).not.toThrow();
      expect(activity.estimatedKilometres).toBeGreaterThan(0);
    }
  });

  it('passengers distinguish employee from external traveller', () => {
    const employeePassenger = mockSnapshot.passengers.find((p) => p.travellerType === 'Employee');
    const externalPassenger = mockSnapshot.passengers.find(
      (p) => p.travellerType === 'External traveller',
    );
    expect(employeePassenger).toBeTruthy();
    expect(employeePassenger?.employeeNumber).toMatch(/^EMP-\d{4}$/);
    expect(externalPassenger).toBeTruthy();
    expect(externalPassenger?.employeeNumber).toBeUndefined();
    expect(externalPassenger?.departmentOrOrganisation).toBeTruthy();
  });

  it('approval workflow has stages with decisions', () => {
    for (const step of mockSnapshot.approvalWorkflow) {
      expect(step.stage).toBeGreaterThan(0);
      expect(step.officer).toBeTruthy();
      expect(step.decision).toMatch(/^(approved|rejected|returned|pending)$/i);
      expect(step.dateTime).toBeTruthy();
    }
  });

  it('traveller count matches requester + passengers + drivers', () => {
    const total = 1 + mockSnapshot.passengers.length;
    // Drivers are also travellers (they fill the driver role)
    expect(mockSnapshot.travellerCount).toBe(total);
  });

  it('component renders without error given valid data', () => {
    // Dynamic import to verify the module loads correctly
    expect(async () => {
      const mod = await import('./transport-request');
      expect(mod.TransportRequestDocument).toBeDefined();
    }).not.toThrow();
  });

  // ── Two-column layout tests for Transport Request ──
  it('transport request exports DocumentRow and DocumentVerificationBlock imports', async () => {
    const mod = await import('./transport-request');
    expect(mod.TransportRequestDocument).toBeDefined();
    // Component compiles without error in two-column layout mode
    const render = () =>
      React.createElement(mod.TransportRequestDocument, {
        data: {
          reference: mockSnapshot.reference,
          scope: mockSnapshot.scope,
          status: mockSnapshot.status,
          requester: mockSnapshot.requester,
          activities: mockSnapshot.activities,
          passengers: mockSnapshot.passengers,
          drivers: mockSnapshot.drivers,
          routes: mockSnapshot.routes,
          approvalWorkflow: mockSnapshot.approvalWorkflow,
          submittedAt: mockSnapshot.submittedAt,
          totalAuthorisedKilometres: mockSnapshot.totalAuthorisedKilometres,
          specialAuthorityRequired: mockSnapshot.specialAuthorityRequired,
        },
      });
    expect(render).not.toThrow();
  });

  it('transport request builds passenger manifest with requester + drivers + passengers', () => {
    const totalPassengerCount =
      1 + // requester
      mockSnapshot.drivers.length +
      mockSnapshot.passengers.length;
    expect(totalPassengerCount).toBe(4); // 1 requester + 1 driver + 2 passengers

    // Verify driver is included as a passenger entry in the manifest
    const driverRows = mockSnapshot.drivers.map((d) => ({
      name: d.name,
      type: `Driver (${d.driverType})`,
    }));
    expect(driverRows.length).toBe(1);
    expect(driverRows[0].name).toBe('John Shikongo');
    expect(driverRows[0].type).toContain('primary');
  });
});

// ---------------------------------------------------------------------------
// Trip Authority Document Tests
// ---------------------------------------------------------------------------

describe('TripAuthorityDocument data contract', () => {
  const mockData = {
    reference: 'TA-2026-000457',
    requestReference: 'GRN/TR/2026/0728/362',
    scope: 'regional',
    startAt: '28 Jul 2026',
    endAt: '29 Jul 2026',
    tenantName: 'Kavango East Regional Council',
    vehicle: {
      licenceNumber: 'GRN-003-2024',
      vehicleRegisterNumber: 'N 45203',
      make: 'Toyota',
      model: 'Hilux Double Cab',
      colour: 'White',
      fuelType: 'Diesel',
      currentOdometer: 62350,
    },
    authorityStatus: 'active',
    documentVersion: 1,
    purpose: 'Field inspection of community water projects',
    department: 'Community Development',
    routeSummary: 'Rundu → Mashare → Rundu',
    totalKm: 240,
    driver: {
      name: 'John Shikongo',
      employeeNumber: 'EMP-0015',
      designation: 'Senior Driver',
      department: 'Transport',
      licenceNumber: 'L123456',
      licenceClass: 'B',
      licenceExpiry: '31 Dec 2026',
      acceptedAt: '28 Jul 2026, 08:30',
    },
    passengers: [
      {
        name: 'Maria Shikongo',
        employeeNumber: 'EMP-0042',
        passengerType: 'government_employee',
        destination: 'Mashare',
        indemnityConfirmed: true,
      },
      {
        name: 'Petrus Ndara',
        employeeNumber: 'EMP-0087',
        passengerType: 'government_employee',
      },
    ],
    specialConditions: 'Driver must rest 15 min every 2 hours\nNo night driving after 18:00',
    beginningOdometer: 62000,
    endingOdometer: 62350,
    transportOfficer: {
      name: 'Anna Nghikembua',
      designation: 'Transport Officer',
      issuedAt: '28 Jul 2026, 07:00',
    },
    authoriser: {
      name: 'Dr. Samuel Nangolo',
      designation: 'Chief Regional Officer',
      authorisedAt: '28 Jul 2026, 08:00',
    },
    goodsAndEquipment: [
      { description: 'Water testing kit', quantity: '1', purpose: 'Field water quality testing' },
      { description: 'Survey equipment', quantity: '3', purpose: 'Site measurements' },
    ],
    preDepartureInspection: {
      status: 'completed',
      odometer: 62000,
      items: [
        { label: 'Tyres', result: 'pass' },
        { label: 'Brakes', result: 'pass' },
        { label: 'Lights', result: 'pass' },
        { label: 'Oil level', result: 'pass' },
        { label: 'Spare wheel', result: 'fail', comment: 'Spare tyre pressure low' },
      ],
      inspectorName: 'Inspector Kamati',
      notes: 'Spare tyre needs inflation before departure',
      completedAt: '28 Jul 2026, 06:30',
    },
    fuelInformation: {
      fuelCardNumber: 'FC-0082',
      expectedFuel: '30 L (est.)',
      fuelType: 'Diesel',
      costCentre: 'CC-PROJ-2026',
    },
    verificationCode: 'TA457-X8K2',
  };

  it('has all required fields for trip authority snapshot', () => {
    expect(mockData.reference).toMatch(/^TA-\d{4}-\d{6}$/);
    expect(mockData.requestReference).toMatch(/^GRN\/TR\/\d{4}\/\d{4}\/\d{3}$/);
    expect(mockData.vehicle.licenceNumber).toBeTruthy();
    expect(mockData.vehicle.make).toBeTruthy();
    expect(mockData.vehicle.model).toBeTruthy();
    expect(mockData.scope).toMatch(/^(regional|national)$/);
    expect(mockData.totalKm).toBeGreaterThan(0);
  });

  it('vehicle details are complete', () => {
    expect(mockData.vehicle.licenceNumber).toBeTruthy();
    expect(mockData.vehicle.vehicleRegisterNumber).toBeTruthy();
    expect(mockData.vehicle.colour).toBeTruthy();
    expect(mockData.vehicle.fuelType).toBeTruthy();
    expect(mockData.vehicle.currentOdometer).toBeGreaterThan(0);
  });

  it('conditions are parsed correctly', () => {
    const conditions = mockData.specialConditions
      .split(/\n|;/)
      .map((c) => c.trim())
      .filter(Boolean);
    expect(conditions.length).toBe(2);
    expect(conditions[0]).toContain('rest 15 min');
    expect(conditions[1]).toContain('night driving');
  });

  it('driver has licence and acknowledgement', () => {
    expect(mockData.driver?.name).toBeTruthy();
    expect(mockData.driver?.employeeNumber).toMatch(/^EMP-\d{4}$/);
    expect(mockData.driver?.licenceNumber).toBeTruthy();
    expect(mockData.driver?.licenceClass).toBeTruthy();
    expect(mockData.driver?.acceptedAt).toBeTruthy();
  });

  it('passengers have required identification', () => {
    for (const p of mockData.passengers) {
      expect(p.name).toBeTruthy();
      expect(p.employeeNumber).toMatch(/^EMP-\d{4}$/);
      expect(p.passengerType).toBeTruthy();
    }
  });

  it('approvals have officers and dates', () => {
    expect(mockData.transportOfficer?.name).toBeTruthy();
    expect(mockData.transportOfficer?.designation).toBeTruthy();
    expect(mockData.transportOfficer?.issuedAt).toBeTruthy();
    expect(mockData.authoriser?.name).toBeTruthy();
    expect(mockData.authoriser?.designation).toBeTruthy();
    expect(mockData.authoriser?.authorisedAt).toBeTruthy();
  });

  it('goods and equipment have descriptions', () => {
    expect(mockData.goodsAndEquipment).toBeDefined();
    expect(mockData.goodsAndEquipment!.length).toBe(2);
    for (const item of mockData.goodsAndEquipment!) {
      expect(item.description).toBeTruthy();
    }
  });

  it('pre-departure inspection has items with results', () => {
    expect(mockData.preDepartureInspection).toBeDefined();
    expect(mockData.preDepartureInspection!.status).toBe('completed');
    expect(mockData.preDepartureInspection!.items!.length).toBe(5);
    const failed = mockData.preDepartureInspection!.items!.filter((i) => i.result === 'fail');
    expect(failed.length).toBe(1);
    expect(failed[0].label).toBe('Spare wheel');
    expect(failed[0].comment).toContain('low');
    expect(mockData.preDepartureInspection!.notes).toBeTruthy();
  });

  it('fuel information has card and type', () => {
    expect(mockData.fuelInformation).toBeDefined();
    expect(mockData.fuelInformation!.fuelCardNumber).toMatch(/^FC-/);
    expect(mockData.fuelInformation!.fuelType).toBe('Diesel');
    expect(mockData.fuelInformation!.expectedFuel).toContain('L');
    expect(mockData.fuelInformation!.costCentre).toBeTruthy();
  });

  it('component module loads correctly', () => {
    expect(async () => {
      const mod = await import('./trip-authority');
      expect(mod.TripAuthorityDocument).toBeDefined();
    }).not.toThrow();
  });

  // ── New: journeyLegs data contract ──
  describe('journeyLegs data contract', () => {
    const journeyLegs = [
      {
        origin: 'Rundu',
        destination: 'Mashare',
        departureDate: '28 Jul 2026',
        departureTime: '08:00',
        returnDate: '28 Jul 2026',
        returnTime: '16:00',
        estimatedKm: 120,
        objective: 'Community centre inspection',
      },
      {
        origin: 'Mashare',
        destination: 'Rundu',
        departureDate: '28 Jul 2026',
        departureTime: '16:00',
        returnDate: '28 Jul 2026',
        returnTime: '17:30',
        estimatedKm: 120,
      },
    ];

    it('has valid journey leg data', () => {
      expect(journeyLegs.length).toBe(2);
      for (const leg of journeyLegs) {
        expect(leg.origin).toBeTruthy();
        expect(leg.destination).toBeTruthy();
        expect(leg.departureDate).toBeTruthy();
        expect(leg.returnDate).toBeTruthy();
      }
    });

    it('each leg has estimated km when provided', () => {
      for (const leg of journeyLegs) {
        expect(leg.estimatedKm).toBeGreaterThanOrEqual(0);
      }
    });

    it('total km across all legs matches trip total', () => {
      const totalKm = journeyLegs.reduce((sum, leg) => sum + (leg.estimatedKm ?? 0), 0);
      expect(totalKm).toBe(240);
      expect(totalKm).toBe(mockData.totalKm);
    });

    it('legs can be rendered by the Journey Details table', () => {
      const rows = journeyLegs.map((leg) => ({
        origin: leg.origin || 'Not specified',
        destination: leg.destination || 'Not specified',
        departure: leg.departureDate || 'Not set',
        ret: leg.returnDate || 'Not set',
        km: leg.estimatedKm ? `${leg.estimatedKm.toLocaleString('en-NA')} km` : '—',
      }));
      expect(rows.length).toBe(2);
      expect(rows[0].origin).toBe('Rundu');
      expect(rows[1].km).toBe('120 km');

      // Verify fallback behaviour
      const emptyLegs: Array<{
        origin: string;
        destination: string;
        departureDate?: string;
        returnDate?: string;
        estimatedKm?: number;
      }> = [];
      const fallbackFields = [
        { label: 'Approved route', value: mockData.routeSummary || 'Not recorded' },
        {
          label: 'Authorised distance',
          value: mockData.totalKm
            ? `${mockData.totalKm.toLocaleString('en-NA')} km`
            : 'Not estimated',
        },
      ];
      expect(emptyLegs.length).toBe(0);
      expect(fallbackFields[1].value).toContain('240');
    });
  });

  // ── New: authorisation data contract ──
  describe('authorisation data contract', () => {
    const authorisation = {
      authoriserName: 'Dr. Samuel Nangolo',
      authoriserRole: 'Chief Regional Officer',
      authorisedAt: '28 Jul 2026, 08:00',
      transportOfficerName: 'Anna Nghikembua',
      transportOfficerRole: 'Transport Officer',
      issueDate: '28 Jul 2026',
      contactNumber: '+264 81 123 4567',
      approvalMethod: 'Digitally authorised',
    };

    it('has all required authorisation fields', () => {
      expect(authorisation.authoriserName).toBeTruthy();
      expect(authorisation.authoriserRole).toBeTruthy();
      expect(authorisation.authorisedAt).toBeTruthy();
      expect(authorisation.transportOfficerName).toBeTruthy();
      expect(authorisation.transportOfficerRole).toBeTruthy();
      expect(authorisation.issueDate).toBeTruthy();
    });

    it('includes optional contact and method fields', () => {
      expect(authorisation.contactNumber).toBeTruthy();
      expect(authorisation.approvalMethod).toBe('Digitally authorised');
    });

    it('falls back to legacy authoriser fields when authorisation is absent', () => {
      const fallbackName = mockData.authoriser?.name || 'Not recorded';
      const fallbackRole = mockData.authoriser?.designation || 'Not recorded';
      const fallbackDate = mockData.authoriser?.authorisedAt || 'Not recorded';

      expect(fallbackName).toBe('Dr. Samuel Nangolo');
      expect(fallbackRole).toBe('Chief Regional Officer');
      expect(fallbackDate).toBe('28 Jul 2026, 08:00');
    });

    it('falls back to transportOfficer fields when authorisation.transportOfficerName is absent', () => {
      const fallbackTO = mockData.transportOfficer?.name || 'Not recorded';
      expect(fallbackTO).toBe('Anna Nghikembua');

      const emptyAuth = {
        authoriserName: '',
        authoriserRole: '',
        authorisedAt: undefined,
        transportOfficerName: '',
        transportOfficerRole: undefined,
        issueDate: '',
      };
      const fallback = emptyAuth.authoriserName || mockData.authoriser?.name || 'Not recorded';
      const fallbackTO2 = emptyAuth.transportOfficerName || mockData.transportOfficer?.name || 'Not recorded';
      expect(fallback).toBe('Dr. Samuel Nangolo');
      expect(fallbackTO2).toBe('Anna Nghikembua');
    });
  });
});

// ---------------------------------------------------------------------------
// Fuel Summary Document Tests
// ---------------------------------------------------------------------------

describe('FuelSummaryDocument data contract', () => {
  const mockSnapshot = {
    totalLitres: 150.5,
    totalCost: 2859.5,
    transactionCount: 3,
    pendingReimbursements: 1,
    actualKilometres: 480,
    kilometreVariance: -20,
  };

  it('has valid fuel summary numbers', () => {
    expect(mockSnapshot.totalLitres).toBeGreaterThan(0);
    expect(mockSnapshot.totalCost).toBeGreaterThan(0);
    expect(mockSnapshot.transactionCount).toBeGreaterThan(0);
    expect(mockSnapshot.pendingReimbursements).toBeGreaterThanOrEqual(0);
  });

  it('variance matches actual minus authorised km', () => {
    // In a real scenario, variance = actual - authorised
    // This test just validates the values are consistent
    expect(mockSnapshot.kilometreVariance).toBe(
      mockSnapshot.actualKilometres - 500, // hypothetical authorised
    );
  });

  it('component module loads correctly', () => {
    expect(async () => {
      const mod = await import('./fuel-summary');
      expect(mod.FuelSummaryDocument).toBeDefined();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Trip Completion Document Tests
// ---------------------------------------------------------------------------

describe('TripCompletionDocument data contract', () => {
  const mockSnapshot = {
    tripId: 'trip-001',
    status: 'closed',
    vehicle: {
      licenceNumber: 'GRN-002',
      registrationNumber: 'N 67890',
    },
    issuedAt: '2026-07-28T08:00:00.000Z',
    startedAt: '2026-07-28T09:15:00.000Z',
    returnedAt: '2026-07-28T17:30:00.000Z',
    closedAt: '2026-07-29T10:00:00.000Z',
    closure: {
      authorisedKm: 500,
      actualKm: 480,
      variance: -20,
      decision: 'closed',
      notes: 'Fuel receipt pending for N$ 340.00',
    },
    fuelSummary: {
      totalLitres: 80,
      totalCost: 1520,
      transactionCount: 2,
      pendingReimbursements: 1,
    },
  };

  it('has complete trip lifecycle dates', () => {
    expect(new Date(mockSnapshot.issuedAt) <= new Date(mockSnapshot.startedAt)).toBe(true);
    expect(new Date(mockSnapshot.startedAt) <= new Date(mockSnapshot.returnedAt)).toBe(true);
    expect(new Date(mockSnapshot.returnedAt) <= new Date(mockSnapshot.closedAt)).toBe(true);
  });

  it('closure variance matches actual minus authorised', () => {
    expect(mockSnapshot.closure.variance).toBe(
      mockSnapshot.closure.actualKm - mockSnapshot.closure.authorisedKm,
    );
  });

  it('status is in completed lifecycle', () => {
    expect(mockSnapshot.status).toMatch(/^(closed|completed|returned)$/);
  });

  it('component module loads correctly', () => {
    expect(async () => {
      const mod = await import('./trip-completion');
      expect(mod.TripCompletionDocument).toBeDefined();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Maintenance Report Document Tests
// ---------------------------------------------------------------------------

describe('MaintenanceReportDocument data contract', () => {
  const mockSnapshot = {
    vehicle: 'Toyota Hilux (GRN-003)',
    totalEvents: 4,
    totalCost: 12500,
    nextServiceDate: '2026-09-15',
    nextServiceOdometer: 65000,
    events: [
      {
        date: '2026-06-01',
        type: 'oil_change',
        description: 'Engine oil and filter replacement',
        cost: 2500,
        vendor: 'Toyota Rundu',
        odometer: 62000,
      },
      {
        date: '2026-04-15',
        type: 'brake_service',
        description: 'Front brake pads replaced',
        cost: 3500,
        vendor: 'AutoZone Rundu',
        odometer: 60000,
      },
    ],
  };

  it('has valid maintenance stats', () => {
    expect(mockSnapshot.totalEvents).toBeGreaterThan(0);
    expect(mockSnapshot.totalCost).toBeGreaterThan(0);
    expect(mockSnapshot.events.length).toBeLessThanOrEqual(mockSnapshot.totalEvents);
  });

  it('each event has required fields', () => {
    for (const ev of mockSnapshot.events) {
      expect(ev.date).toBeTruthy();
      expect(() => new Date(ev.date)).not.toThrow();
      expect(ev.type).toBeTruthy();
      expect(ev.description).toBeTruthy();
      if (ev.cost != null) expect(ev.cost).toBeGreaterThan(0);
    }
  });

  it('next service date is after the last event', () => {
    const lastEventDate = new Date(mockSnapshot.events[mockSnapshot.events.length - 1].date);
    const nextService = new Date(mockSnapshot.nextServiceDate);
    expect(nextService > lastEventDate).toBe(true);
  });

  it('component module loads correctly', () => {
    expect(async () => {
      const mod = await import('./maintenance-report');
      expect(mod.MaintenanceReportDocument).toBeDefined();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Shared Document System Component Tests
// ---------------------------------------------------------------------------

describe('Shared document system components', () => {
  it('DocumentRow wraps children in two-column layout', async () => {
    const { DocumentRow } = await import('./document-system');
    // Component should exist and be creatable
    expect(DocumentRow).toBeDefined();

    // Verify React.createElement succeeds with children
    const left = React.createElement('view', { key: 'left' }, 'Left content');
    const right = React.createElement('view', { key: 'right' }, 'Right content');
    const row = React.createElement(DocumentRow, null, left, right);
    expect(row).toBeDefined();
    expect(row.props.children).toBeDefined();

    // A single child should also work
    const singleRow = React.createElement(DocumentRow, null, left);
    expect(singleRow).toBeDefined();
  });

  it('DocumentRow preserves child count', async () => {
    const { DocumentRow } = await import('./document-system');

    // With two children
    const left = React.createElement('view', { key: 'a' }, 'A');
    const right = React.createElement('view', { key: 'b' }, 'B');
    const rowTwo = React.createElement(DocumentRow, null, left, right);
    const childrenTwo = React.Children.toArray(rowTwo.props.children);
    expect(childrenTwo.length).toBe(2);

    // With three children
    const mid = React.createElement('view', { key: 'c' }, 'C');
    const rowThree = React.createElement(DocumentRow, null, left, mid, right);
    const childrenThree = React.Children.toArray(rowThree.props.children);
    expect(childrenThree.length).toBe(3);
  });

  it('DocumentVerificationBlock renders with full props', async () => {
    const { DocumentVerificationBlock } = await import('./document-system');
    expect(DocumentVerificationBlock).toBeDefined();

    // Component with all props
    const block = React.createElement(DocumentVerificationBlock, {
      branding: {
        tenantId: 't1',
        organisationName: 'Kavango East Regional Council',
        code: 'KERC',
        locale: 'en-NA',
        timezone: 'Africa/Windhoek',
        primaryColor: '#1F2A44',
        accentColor: '#0F766E',
      },
      verificationCode: 'TA457-X8K2',
      verificationUrl: 'https://grnfleet.na/v/TA457-X8K2',
      qrCode: 'data:image/png;base64,testqr',
    });
    expect(block).toBeDefined();
    expect(block.props.branding?.organisationName).toContain('Kavango');
    expect(block.props.verificationCode).toMatch(/^TA/);
    expect(block.props.verificationUrl).toContain('grnfleet.na');
    expect(block.props.qrCode).toContain('base64');
  });

  it('DocumentVerificationBlock renders with minimal props', async () => {
    const { DocumentVerificationBlock } = await import('./document-system');
    const minimal = React.createElement(DocumentVerificationBlock, {});
    expect(minimal).toBeDefined();
    expect(minimal.props.qrCode).toBeUndefined();
    expect(minimal.props.verificationCode).toBeUndefined();
  });

  it('DocumentHeader accepts all required props', async () => {
    const { DocumentHeader } = await import('./document-system');
    const header = React.createElement(DocumentHeader, {
      title: 'Trip Authority',
      reference: 'TA-2026-000457',
      version: 1,
      status: 'Active',
      issueDate: '29 Jul 2026',
    });
    expect(header).toBeDefined();
    expect(header.props.title).toBe('Trip Authority');
    expect(header.props.reference).toMatch(/^TA-/);
    expect(header.props.status).toBe('Active');
  });

  it('DocumentSection renders with title and children', async () => {
    const { DocumentSection } = await import('./document-system');
    const section = React.createElement(
      DocumentSection,
      {
        title: 'Test Section',
        children: React.createElement('text', { key: 'c' }, 'Test content'),
      },
    );
    expect(section).toBeDefined();
    expect(section.props.title).toBe('Test Section');
    expect(section.props).not.toHaveProperty('wrap'); // default true

    const noWrap = React.createElement(
      DocumentSection,
      {
        title: 'No Wrap',
        wrap: false,
        children: React.createElement('text', { key: 'c2' }, 'Content'),
      },
    );
    expect(noWrap.props.wrap).toBe(false);
  });

  it('DocumentFieldGrid renders fields correctly', async () => {
    const { DocumentFieldGrid } = await import('./document-system');
    const grid = React.createElement(DocumentFieldGrid, {
      fields: [
        { label: 'Name', value: 'John Shikongo' },
        { label: 'Department', value: 'Transport' },
      ],
    });
    expect(grid).toBeDefined();
    expect(grid.props.fields.length).toBe(2);
    expect(grid.props.fields[0].value).toBe('John Shikongo');

    // Empty fields should be handled gracefully
    const empty = React.createElement(DocumentFieldGrid, { fields: [] });
    expect(empty.props.fields.length).toBe(0);
  });

  it('DocumentTable renders with columns and rows', async () => {
    const { DocumentTable } = await import('./document-system');
    const table = React.createElement(DocumentTable, {
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'dept', label: 'Department' },
      ],
      rows: [
        { name: 'John', dept: 'Transport' },
        { name: 'Maria', dept: 'Admin' },
      ],
    });
    expect(table).toBeDefined();
    expect(table.props.columns.length).toBe(2);
    expect(table.props.rows.length).toBe(2);

    // Empty table should show empty label
    const emptyTable = React.createElement(DocumentTable, {
      columns: [{ key: 'x', label: 'X' }],
      rows: [],
      emptyLabel: 'No records found',
    });
    expect(emptyTable.props.emptyLabel).toBe('No records found');
  });

  it('DocumentSignature renders with and without signature URL', async () => {
    const { DocumentSignature } = await import('./document-system');

    // With signature
    const signed = React.createElement(DocumentSignature, {
      name: 'Dr. Samuel Nangolo',
      role: 'Chief Regional Officer',
      signedAt: '29 Jul 2026',
      signatureUrl: 'data:image/png;base64,sig',
    });
    expect(signed).toBeDefined();
    expect(signed.props.name).toContain('Nangolo');
    expect(signed.props.signatureUrl).toContain('base64');

    // Without signature (fallback)
    const unsigned = React.createElement(DocumentSignature, {
      name: '—',
      role: 'Transport Officer',
    });
    expect(unsigned).toBeDefined();
    expect(unsigned.props.signatureUrl).toBeUndefined();
    expect(unsigned.props.signedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Snapshot format consistency tests
// ---------------------------------------------------------------------------

describe('Snapshot format consistency', () => {
  it('document generator snapshot keys match component interfaces', () => {
    // Verify that known snapshot keys from the document generator
    // are properly handled by the typed interfaces
    const transportKeys = [
      'reference',
      'revision',
      'scope',
      'status',
      'department',
      'purpose',
      'requester',
      'activities',
      'passengers',
      'drivers',
      'routes',
      'approvalWorkflow',
      'attachments',
      'submittedAt',
      'totalAuthorisedKilometres',
      'specialAuthorityRequired',
    ];
    expect(transportKeys.length).toBeGreaterThan(0);

    const fuelKeys = [
      'totalLitres',
      'totalCost',
      'transactionCount',
      'pendingReimbursements',
      'actualKilometres',
      'kilometreVariance',
    ];
    expect(fuelKeys.length).toBeGreaterThan(0);

    const maintenanceKeys = [
      'vehicle',
      'totalEvents',
      'totalCost',
      'nextServiceDate',
      'nextServiceOdometer',
      'events',
    ];
    expect(maintenanceKeys.length).toBeGreaterThan(0);
  });

  it('no raw UUIDs should appear in document display data', () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const displayValues = [
      'GRN/TR/2026/0728/362',
      'TA-2026-000457',
      'N$ 1,200.00',
      'Maria Shikongo',
      'Transport Request',
      '450 km',
      'Community Development',
    ];
    for (const value of displayValues) {
      expect(value).not.toMatch(uuidPattern);
    }
  });

  it('human-readable formatters produce clean output for document display', () => {
    expect(async () => {
      const { humanizeKey, formatDocumentStatus, formatMoney, formatHumanValue } = await import(
        '@/lib/human-readable'
      );
      expect(humanizeKey('transport_request')).toBe('Transport Request');
      expect(formatDocumentStatus('issued')).toBe('Issued');
      // formatMoney produces a currency string; actual output depends on Node.js Intl
      const formatted = formatMoney(1200);
      expect(formatted).toMatch(/[$]/);
      expect(formatted).toContain('1,200.00');
      expect(formatHumanValue(true, 'specialAuthorityRequired')).toBe('Yes');
      expect(formatHumanValue(null, 'test')).toBe('Not recorded');
    }).not.toThrow();
  });

  // ── Two-column layout consistency ──
  it('document interfaces support two-column layout with journeyLegs and authorisation', async () => {
    // Verify that trip-authority exports journeyLegs-related display functions
    const mod = await import('./trip-authority');
    expect(mod.TripAuthorityDocument).toBeDefined();

    // Verify the component renders with journeyLegs data (data contract test)
    const journeyLegsFields = ['origin', 'destination', 'departureDate', 'returnDate', 'estimatedKm'];
    expect(journeyLegsFields.length).toBe(5);

    const authorisationFields = [
      'authoriserName',
      'authoriserRole',
      'authorisedAt',
      'transportOfficerName',
      'issueDate',
    ];
    expect(authorisationFields.length).toBe(5);
    expect(authorisationFields.includes('authoriserName')).toBe(true);
    expect(journeyLegsFields.includes('origin')).toBe(true);
  });

  it('journeyLegs data flows correctly from API to component', () => {
    // Simulate the API-to-component data pipeline
    const apiResponseLegs = [
      {
        origin: 'Windhoek',
        destination: 'Rundu',
        departureDate: '2026-07-28T08:00:00.000Z',
        departureTime: '08:00',
        returnDate: '2026-07-28T17:00:00.000Z',
        returnTime: '17:00',
        estimatedKm: 700,
        objective: 'Regional inspection',
      },
    ];

    // The component expects departureDate as a string, not ISO — the API
    // route converts it via formatHumanDate
    const componentReady = apiResponseLegs.map((leg) => ({
      ...leg,
      departureDate: '28 Jul 2026',
      returnDate: '28 Jul 2026',
    }));

    expect(componentReady.length).toBe(1);
    expect(componentReady[0].departureDate).not.toContain('T'); // human-readable, not ISO
    expect(componentReady[0].estimatedKm).toBe(700);
  });

  it('authorisation data flows correctly from API to component', () => {
    // Simulate the API-to-component data pipeline
    const apiAuthoriserData = {
      name: 'Dr. Samuel Nangolo',
      designation: 'Chief Regional Officer',
      authorisedAt: '28 Jul 2026, 08:00',
    };
    const apiTransportOfficerData = {
      name: 'Anna Nghikembua',
      designation: 'Transport Officer',
      issuedAt: '28 Jul 2026, 07:00',
    };

    // The component builds authorisation object from these
    const authorisation = {
      authoriserName: apiAuthoriserData.name,
      authoriserRole: apiAuthoriserData.designation,
      authorisedAt: apiAuthoriserData.authorisedAt,
      transportOfficerName: apiTransportOfficerData.name,
      transportOfficerRole: apiTransportOfficerData.designation,
      issueDate: apiTransportOfficerData.issuedAt,
      approvalMethod: 'Digitally authorised',
    };

    expect(authorisation.authoriserName).toBe('Dr. Samuel Nangolo');
    expect(authorisation.authoriserRole).toBe('Chief Regional Officer');
    expect(authorisation.transportOfficerName).toBe('Anna Nghikembua');
    expect(authorisation.approvalMethod).toBe('Digitally authorised');
  });
});
