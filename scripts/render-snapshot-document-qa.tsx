import React from 'react';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { renderToFile } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { FuelSummaryDocument, type FuelSummaryData } from '../src/lib/pdf/fuel-summary';
import { TripCompletionDocument, type TripCompletionData } from '../src/lib/pdf/trip-completion';
import {
  MaintenanceReportDocument,
  type MaintenanceReportData,
} from '../src/lib/pdf/maintenance-report';
import { MvaReportDocument, type MvaReportData } from '../src/lib/pdf/mva-report';
import type { ResolvedTenantBranding } from '../src/lib/tenant-branding';

const root = process.cwd();
const output = process.env.OFFICIAL_DOCUMENT_QA_OUTPUT_DIR
  ? path.resolve(process.env.OFFICIAL_DOCUMENT_QA_OUTPUT_DIR)
  : path.join(root, 'docs', 'official-document-system', 'artifacts');
await mkdir(output, { recursive: true });

const asPdfDocument = (element: React.ReactElement) =>
  element as Parameters<typeof renderToFile>[0];

const branding: ResolvedTenantBranding = {
  tenantId: 'qa-tenant',
  organisationName: 'Kavango East Regional Council',
  code: 'KERC',
  locale: 'en-NA',
  timezone: 'Africa/Windhoek',
  division: 'Fleet Management',
  address: 'Government Building, Rundu, Namibia',
  phone: '+264 66 123 456',
  email: 'transport@kavangoeast.gov.na',
  logoUrl: path.join(root, 'public', 'official', 'reference-tenant-logo.png'),
  primaryColor: '#245B9E',
  accentColor: '#0F766E',
  executiveSignatoryName: 'Erasmus Nakiengopo',
  executiveSignatoryTitle: 'Chief Executive Officer',
  documentFooter: 'Kavango East Regional Council · Fleet Management Internal Record',
};

const generatedAt = '2026-08-14T18:30:00+02:00';
const verificationUrl = 'https://grnfleet.na/v/QA-SNAPSHOT-2026';
const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });
const common = {
  branding,
  documentVersion: 2,
  generatedAt,
  verificationCode: 'QA-SNAPSHOT-2026',
  verificationUrl,
  documentHash: '1b4f3f1b…7d9a0c55',
  qrCodeDataUrl,
};

const fuelSummary: FuelSummaryData = {
  tripId: '7a6bcf67-b138-4bd1-a63d-001122334455',
  totalLitres: 146.8,
  totalCost: 3268.42,
  transactionCount: 3,
  pendingReimbursements: 1,
  actualKilometres: 1187,
  kilometreVariance: 27,
  vehicleLicence: 'GRN-81768',
  vehicleRegisterNumber: 'E2E-81768',
  tripReference: 'TA-2026-KERC-00457',
  tripPurpose: 'Regional programme coordination and field verification',
  status: 'issued',
  transactions: [
    {
      transactionAt: '2026-08-12T08:15:00+02:00',
      stationName: 'TotalEnergies Rundu',
      fuelType: 'diesel',
      litres: 46.8,
      amount: 1035.42,
      paymentMethod: 'fuel_card',
      odometerReading: 40125,
    },
    {
      transactionAt: '2026-08-13T11:40:00+02:00',
      stationName: 'Puma Divundu',
      fuelType: 'diesel',
      litres: 50,
      amount: 1115,
      paymentMethod: 'fuel_card',
      odometerReading: 40560,
    },
    {
      transactionAt: '2026-08-14T15:20:00+02:00',
      stationName: 'Shell Rundu',
      fuelType: 'diesel',
      litres: 50,
      amount: 1118,
      paymentMethod: 'personal_reimbursement',
      odometerReading: 41290,
    },
  ],
  ...common,
};

const tripCompletion: TripCompletionData = {
  tripId: '7a6bcf67-b138-4bd1-a63d-001122334455',
  status: 'completed',
  statusText: 'issued',
  vehicle: { licenceNumber: 'GRN-81768', registrationNumber: 'E2E-81768' },
  issuedAt: '2026-08-11T16:00:00+02:00',
  startedAt: '2026-08-12T07:30:00+02:00',
  returnedAt: '2026-08-14T17:20:00+02:00',
  closedAt: '2026-08-14T18:10:00+02:00',
  routeKm: 1160,
  closure: {
    authorisedKm: 1160,
    actualKm: 1187,
    variance: 27,
    decision: 'accepted_with_explanation',
    notes: 'Approved route deviation due to an official programme stop.',
  },
  fuelSummary: {
    totalLitres: 146.8,
    totalCost: 3268.42,
    transactionCount: 3,
    pendingReimbursements: 1,
  },
  eventSummary: {
    total: 1,
    incidents: 1,
    defects: 0,
    accidents: 0,
    injuries: 0,
    critical: 0,
    events: [
      {
        number: 'INC-2026-KERC-00014',
        type: 'breakdown',
        severity: 'medium',
        occurredAt: '2026-08-13T14:20:00+02:00',
        continuationState: 'safe_to_continue',
        status: 'resolved',
        description: 'Coolant hose leak repaired before continuing the trip.',
      },
    ],
  },
  ...common,
};

const maintenance: MaintenanceReportData = {
  vehicleId: '4468dc88-1bb0-4a80-8461-556677889900',
  vehicle: 'Toyota Corolla Quest',
  licenceNumber: 'GRN-81768',
  vehicleRegisterNumber: 'E2E-81768',
  make: 'Toyota',
  model: 'Corolla Quest',
  totalEvents: 4,
  totalCost: 12840.75,
  nextServiceDate: '2026-11-15',
  nextServiceOdometer: 50000,
  status: 'issued',
  events: [
    {
      date: '2026-02-15',
      type: 'scheduled_service',
      description: 'Engine oil, filters and general inspection',
      cost: 3280.5,
      vendor: 'Rundu Auto Centre',
      odometer: 31200,
    },
    {
      date: '2026-05-09',
      type: 'tyre_replacement',
      description: 'Replacement of two front tyres and wheel alignment',
      cost: 4760.25,
      vendor: 'Northern Tyres',
      odometer: 35800,
    },
    {
      date: '2026-07-02',
      type: 'repair',
      description: 'Brake pad replacement',
      cost: 2800,
      vendor: 'Rundu Auto Centre',
      odometer: 38900,
    },
    {
      date: '2026-08-13',
      type: 'roadside_repair',
      description: 'Coolant hose replacement after breakdown report',
      cost: 2000,
      vendor: 'Fleet roadside assistance',
      odometer: 40780,
    },
  ],
  ...common,
};

const mva: MvaReportData = {
  reference: 'MVA-2026-KERC-00008',
  severity: 'moderate',
  status: 'investigation_closed',
  occurredAt: '2026-08-10T17:35:00+02:00',
  location: 'B8 road, approximately 12 km west of Rundu',
  description: 'Low-speed collision with a third-party vehicle while returning from official duty.',
  immediateAction: 'Vehicle stopped safely, passengers checked and police notified.',
  continuationState: 'vehicle_recovered',
  vehicleSafe: false,
  passengerSafe: true,
  injuries: false,
  numberInjured: 0,
  vehicleDamage: true,
  thirdPartyInvolvement: true,
  policeReference: 'NAMPOL-RUNDU-2026-0810-44',
  emergencyServicesContacted: true,
  detailsRequired: false,
  tripReferences: {
    transportRequest: 'GRN/TR/2026/000451',
    tripAuthority: 'TA-2026-KERC-00451',
  },
  vehicle: {
    registration: 'GRN-81768',
    registerNumber: 'E2E-81768',
    make: 'Toyota',
    model: 'Corolla Quest',
  },
  accidentReportNumber: 'MVAR-2026-KERC-00008',
  investigationStatus: 'closed',
  investigationNotes: 'Driver statement and police report reviewed. No injuries recorded.',
  investigationClosedAt: '2026-08-14T11:30:00+02:00',
  witnessStatements: [
    { name: 'Passenger One', statement: 'Vehicle was travelling at low speed before impact.' },
  ],
  thirdPartyDetails: { name: 'Third Party Driver', vehicle: 'N 12345 W' },
  insuranceClaimReference: 'CLAIM-KERC-2026-008',
  insuranceNotified: true,
  insuranceNotifiedAt: '2026-08-11T09:00:00+02:00',
  policeReportFiled: true,
  thirdPartyInsuranceDetails: { insurer: 'Example Insurance' },
  technicalClearanceStatus: 'pending_repair',
  technicalClearanceAt: null,
  technicalClearanceByUserId: null,
  ...common,
};

await Promise.all([
  renderToFile(
    asPdfDocument(React.createElement(FuelSummaryDocument, { data: fuelSummary })),
    path.join(output, 'fuel-summary-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(TripCompletionDocument, { data: tripCompletion })),
    path.join(output, 'trip-completion-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(MaintenanceReportDocument, { data: maintenance })),
    path.join(output, 'maintenance-report-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(MvaReportDocument, { data: mva })),
    path.join(output, 'mva-report-reference.pdf'),
  ),
]);

console.log(`Rendered generated snapshot document QA artifacts to ${output}`);
