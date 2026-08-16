import React from 'react';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { renderToFile } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { TripAuthorityDocument, type TripAuthorityData } from '../src/lib/pdf/trip-authority';
import {
  TransportRequestDocument,
  type TransportRequestData,
} from '../src/lib/pdf/transport-request';
import { ReportDocument, type ReportData } from '../src/lib/pdf/report';
import {
  InspectionReportDocument,
  type InspectionReportData,
} from '../src/lib/pdf/inspection-report';
import {
  DriverLogsheetDocument,
  FuelReceiptDocument,
  IncidentRecordDocument,
  type DriverLogsheetData,
  type FuelReceiptData,
  type IncidentRecordData,
} from '../src/lib/pdf/operational-records';
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
  division: 'Office / Ministry / Department / Municipality',
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
const verificationUrl = 'https://grnfleet.na/v/TA-2026-457';
const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 });
const hash = '8f34421b8ce21a97cc7e6c3df8a9a58e679a0b1e2d3e45f996f78a831jk10jm';

const authority: TripAuthorityData = {
  reference: '5886775',
  branding,
  requestReference: 'GRN/TR/2026/000457',
  scope: 'regional',
  startAt: '2026-12-27T08:00:00+02:00',
  endAt: '2026-12-30T20:00:00+02:00',
  purpose: 'To attend GRN PUS meeting in Windhoek',
  totalKm: 2100,
  authorityStatus: 'issued',
  verificationCode: 'VER-8F34021',
  verificationUrl,
  qrCodeDataUrl,
  documentHash: hash,
  beginningOdometer: 149517,
  vehicle: {
    licenceNumber: 'GRN-81768',
    vehicleRegisterNumber: 'E2E-81768',
    make: 'Toyota',
    model: 'Corolla Quest',
    modelYear: 2014,
    colour: 'White',
    fuelType: 'petrol',
    inspectionStatus: 'passed',
    inspectionDate: '2026-07-24',
  },
  driver: {
    name: 'John Shikongo',
    employeeNumber: '200615327',
    licenceNumber: 'S0010000167R',
    department: 'Transport',
    contactNumber: '0814942473',
    idNumber: '840926 10 5647 2',
    acceptedAt: '2026-07-28T08:15:00+02:00',
  },
  additionalDrivers: [
    {
      name: 'Martin Mukoya',
      employeeNumber: '200976475',
      licenceNumber: 'B00164EJIRK',
      department: 'Accounting',
      contactNumber: '0814376743',
      idNumber: '861010 12 3456 7',
    },
    {
      name: 'Anna Nghikembua',
      employeeNumber: '236076165',
      licenceNumber: 'N00123LIPPH',
      department: 'Civilian',
      contactNumber: '0816787900',
      idNumber: '910305 07 8912 1',
    },
  ],
  journeyLegs: [
    {
      origin: 'Rundu',
      destination: 'Divundu',
      departureDate: '2026-12-27',
      departureTime: '08:00',
      returnDate: '2026-12-27',
      returnTime: '20:00',
      estimatedKm: 700,
    },
    {
      origin: 'Divundu',
      destination: 'Mashare',
      departureDate: '2026-12-28',
      departureTime: '08:00',
      returnDate: '2026-12-28',
      returnTime: '20:00',
      estimatedKm: 700,
    },
    {
      origin: 'Mashare',
      destination: 'Rundu',
      departureDate: '2026-12-29',
      departureTime: '08:00',
      returnDate: '2026-12-30',
      returnTime: '20:00',
      estimatedKm: 700,
    },
  ],
  passengers: [
    {
      name: 'Martin Mukoya',
      employeeNumber: '200976475',
      department: 'Accounting',
      contactNumber: '0814376743',
      indemnityConfirmed: true,
    },
    {
      name: 'John Shikongo',
      employeeNumber: '200615327',
      department: 'Transport',
      contactNumber: '0814942473',
      indemnityConfirmed: true,
    },
    {
      name: 'Kandjimi Ampuanda',
      employeeNumber: '4768700',
      department: 'Planning',
      contactNumber: '0815244900',
      indemnityConfirmed: true,
    },
    {
      name: 'Anna Nghikembua',
      employeeNumber: '236076165',
      department: 'Civilian',
      contactNumber: '0816787900',
      indemnityConfirmed: false,
    },
  ],
  goodsAndEquipment: [
    { description: 'Survey equipment', quantity: '2 sets', purpose: 'Field data collection' },
    { description: 'Laptop', quantity: '1 unit', purpose: 'Reporting' },
    { description: 'Documents / files', quantity: '1 set', purpose: 'Official use' },
  ],
  specialConditions:
    'Vehicle may exceed estimated kilometres due to approved stops and route variations required for official duty.',
  transportOfficer: {
    name: 'Anna Nghikembua',
    designation: 'Transport Officer',
    issuedAt: '2026-07-28',
  },
  authoriser: {
    name: 'Erasmus Nakiengopo',
    designation: 'Executive Director',
    authorisedAt: '2026-07-28',
  },
};

const longAuthority: TripAuthorityData = {
  ...authority,
  reference: 'STRESS-TA-2026-000001',
  purpose:
    'Multi-region official programme coordination and field verification exercise with deliberately long descriptive content to validate line wrapping, continuation pages, stable table widths, and final-page approval anchoring.',
  journeyLegs: Array.from({ length: 24 }, (_, index) => ({
    origin: `Origin settlement ${index + 1}`,
    destination: `Destination regional office ${index + 1}`,
    departureDate: `2026-12-${String((index % 20) + 1).padStart(2, '0')}`,
    departureTime: '07:30',
    returnDate: `2026-12-${String((index % 20) + 1).padStart(2, '0')}`,
    returnTime: '18:45',
    estimatedKm: 125 + index,
  })),
  passengers: Array.from({ length: 32 }, (_, index) => ({
    name: `Authorised Passenger With Long Name ${index + 1}`,
    employeeNumber: `EMP-${String(index + 1).padStart(5, '0')}`,
    department: 'Community Development and Regional Coordination',
    contactNumber: `081000${String(index).padStart(4, '0')}`,
    indemnityConfirmed: index % 3 !== 0,
  })),
  goodsAndEquipment: Array.from({ length: 18 }, (_, index) => ({
    description: `Field equipment package ${index + 1}`,
    quantity: `${index + 1} units`,
    purpose: 'Official programme delivery, verification, reporting and secure evidence collection',
  })),
};

const request: TransportRequestData = {
  reference: 'GRN/TR/2026/000457',
  revision: 2,
  scope: 'regional',
  status: 'approved',
  branding,
  purpose: authority.purpose,
  submittedAt: '2026-07-25T10:00:00+02:00',
  totalAuthorisedKilometres: 2100,
  specialAuthorityRequired: true,
  verificationCode: 'VER-TR0457',
  verificationUrl,
  qrCodeDataUrl,
  documentHash: hash,
  requester: {
    name: 'Kandjimi Ampuanda',
    employeeNumber: '4768700',
    designation: 'Senior Planner',
    department: 'Planning',
    office: 'Rundu Head Office',
    phone: '0815244900',
    email: 'k.ampuanda@example.gov.na',
  },
  activities: [
    {
      title: 'GRN PUS meeting',
      description: 'Official coordination meeting',
      venue: 'Windhoek',
      startDate: '2026-12-27T08:00:00+02:00',
      endDate: '2026-12-30T17:00:00+02:00',
      estimatedKilometres: 2100,
    },
  ],
  routes: authority.journeyLegs?.map((leg) => ({
    origin: leg.origin,
    destination: leg.destination,
    estimatedKilometres: leg.estimatedKm,
  })),
  passengers: authority.passengers?.map((person) => ({
    name: person.name,
    employeeNumber: person.employeeNumber,
    departmentOrOrganisation: person.department,
    travellerType: 'Employee',
  })),
  drivers: [
    {
      driverType: 'nominated',
      name: 'John Shikongo',
      employeeNumber: '200615327',
      department: 'Transport',
    },
  ],
  goodsAndEquipment: authority.goodsAndEquipment,
  approvalWorkflow: [
    {
      stage: 1,
      officer: 'Petrus Ndara',
      decision: 'approved',
      dateTime: '2026-07-26T10:30:00+02:00',
      signature: 'Digitally signed',
    },
  ],
};

const report: ReportData = {
  title: 'Fuel Consumption Report',
  period: 'Last 30 Days',
  branding,
  generatedAt: 'Sat, 08 Aug 2026',
  verificationCode: 'VER-8F34021',
  verificationUrl,
  documentHash: hash,
  qrCodeDataUrl,
  summary: [
    { label: 'Total litres', value: '1,440.5 L' },
    { label: 'Total cost', value: 'N$ 24,833.50' },
    { label: 'Transactions', value: '35' },
  ],
  columns: [
    { key: 'vehicle', label: 'Vehicle', width: '25%' },
    { key: 'date', label: 'Date', width: '18%' },
    { key: 'litres', label: 'Litres', width: '14%' },
    { key: 'amount', label: 'Amount (N$)', width: '18%' },
    { key: 'station', label: 'Station', width: '25%' },
  ],
  rows: Array.from({ length: 58 }, (_, index) => ({
    vehicle: `E2E-${1786000000000 + index}`,
    date: `07 Aug 2026 ${String(8 + (index % 10)).padStart(2, '0')}:25`,
    litres: (35 + index / 2).toFixed(2),
    amount: (700 + index * 13.5).toFixed(2),
    station: index % 2 ? 'E2E Fuel Station' : 'TotalEnergies Rundu',
  })),
  totalRowCount: 58,
};

const tripSummaryReport: ReportData = {
  branding,
  title: 'Trip Summary Report',
  orientation: 'landscape',
  period: 'Last 30 Days',
  generatedAt: '2026-08-11T10:00:00+02:00',
  verificationCode: 'VER-8F34021',
  verificationUrl,
  documentHash: hash,
  qrCodeDataUrl,
  summary: [
    { label: 'Total trips', value: '59' },
    { label: 'Total route', value: '5,800 km' },
    { label: 'Total actual', value: '5,605 km' },
  ],
  columns: [
    { key: 'authorityNumber', label: 'Trip Authority', width: '12%' },
    { key: 'authorityStatus', label: 'Authority Status', width: '13%' },
    { key: 'status', label: 'Status', width: '8%' },
    { key: 'vehicle', label: 'Vehicle', width: '10%' },
    { key: 'origin', label: 'Origin', width: '13%' },
    { key: 'destination', label: 'Destination', width: '13%' },
    { key: 'routeKm', label: 'Route (km)', width: '6%', align: 'right' },
    { key: 'actualKm', label: 'Actual (km)', width: '6%', align: 'right' },
    { key: 'started', label: 'Started', width: '9.5%' },
    { key: 'returned', label: 'Returned', width: '9.5%' },
  ],
  rows: Array.from({ length: 31 }, (_, index) => ({
    authorityNumber: `TA-2026-KERC-${String(index + 1).padStart(7, '0')}`,
    authorityStatus:
      index % 3 === 0
        ? 'Awaiting Driver Acceptance'
        : index % 3 === 1
          ? 'Awaiting Pre Trip Inspection'
          : 'Issued',
    status: index % 3 === 0 ? 'driver_accepted' : index % 3 === 1 ? 'completed' : 'in_progress',
    vehicle: `E2E-${1786000000000 + index}`,
    origin: index % 2 ? 'Rundu, Kavango East' : 'Windhoek, Khomas Region',
    destination: index % 2 ? 'Windhoek, Khomas Region' : 'Rundu, Kavango East',
    routeKm: 540 + index * 8,
    actualKm: index % 4 === 0 ? 'Not recorded' : 532 + index * 8,
    started: `11 Aug 2026 ${String(8 + (index % 10)).padStart(2, '0')}:25`,
    returned: index % 4 === 0 ? 'Not recorded' : '12 Aug 2026 18:45',
  })),
  totalRowCount: 31,
};

const inspection: InspectionReportData = {
  inspectionId: '1fc1d7ef-6a73-45bd-8fe4-8f34021c2026',
  type: 'departure',
  vehicle: {
    licenceNumber: 'E2E-1786074236874',
    registrationNumber: 'GRN-81768',
  },
  odometerReading: 40_010,
  fuelLevel: 'Full',
  overallPass: true,
  status: 'completed',
  notes: 'Vehicle passed the departure inspection with no blocking defects.',
  inspectedAt: '2026-08-10T08:15:00+02:00',
  inspectorName: 'Anna Nghikembua',
  driverName: 'John Shikongo',
  inspectorSignedAt: '2026-08-10T08:16:00+02:00',
  driverSignedAt: '2026-08-10T08:17:00+02:00',
  branding,
  items: [
    { category: 'exterior', label: 'Tyres and wheel condition', result: 'pass' },
    { category: 'exterior', label: 'Lights, indicators and reflectors', result: 'pass' },
    { category: 'engine', label: 'Engine oil and coolant levels', result: 'pass' },
    { category: 'cabin', label: 'Seatbelts and mirrors', result: 'pass' },
    { category: 'safety', label: 'First aid kit and warning triangle', result: 'pass' },
    {
      category: 'documentation',
      label: 'Vehicle licence and trip authority present',
      result: 'pass',
    },
  ],
  verificationCode: 'VER-8F34021',
  verificationUrl,
  documentHash: hash,
  qrCodeDataUrl,
};

const fuelReceipt: FuelReceiptData = {
  branding,
  generatedAt: '2026-08-07T12:52:00+02:00',
  receiptNumber: 'FU-1786107137076',
  status: 'verified',
  vehicle: 'E2E-FU-1786107137076',
  odometer: 39_030,
  fuelType: 'diesel',
  litres: 40,
  amount: 900,
  station: 'E2E Fuel Station',
  location: 'Rundu, Kavango East',
  pricePerLitre: 22.5,
  paymentMethod: 'fleet_card',
  attendant: 'Not recorded',
  attachments: [
    {
      name: 'receipt_20260807_125225.jpg',
      uploadedBy: 'Michael Mwala',
      uploadedAt: '2026-08-07T12:53:00+02:00',
    },
  ],
  verifiedBy: 'Transport Officer',
  verifiedAt: '2026-08-07T12:55:00+02:00',
  verificationResult: 'approved',
  verificationNotes: 'Receipt verified against the transaction.',
  verificationCode: 'VER-8F34021',
  verificationUrl,
  documentHash: hash,
  qrCodeDataUrl,
};

const driverLogsheet: DriverLogsheetData = {
  branding,
  generatedAt: '2026-08-11T08:00:00+02:00',
  driver: 'Michael Mwala',
  period: '01–10 August 2026',
  entries: Array.from({ length: 12 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, '0')}T08:00:00+02:00`,
    startKm: 38_200 + index * 65,
    endKm: 38_265 + index * 65,
    distance: 65,
    purposeOrRoute: index % 2 ? 'Rundu → Windhoek → Rundu' : 'Rundu → Divundu → Rundu',
    tripAuthority: `TA-2026-KERC-${String(index + 1).padStart(5, '0')}`,
    remarks: index % 3 ? 'Official duty' : 'Community visit',
  })),
  verificationCode: 'VER-8F34021',
  verificationUrl,
  documentHash: hash,
  qrCodeDataUrl,
};

const incidentRecord: IncidentRecordData = {
  branding,
  generatedAt: '2026-08-09T16:45:00+02:00',
  reference: 'INC-2026-KERC-00014',
  type: 'vehicle_breakdown',
  severity: 'medium',
  status: 'resolved',
  vehicle: 'GRN-81768 · Toyota Corolla Quest',
  tripAuthority: 'TA-2026-KERC-00009',
  occurredAt: '2026-08-09T14:20:00+02:00',
  location: 'B8, 18 km east of Rundu',
  description:
    'Vehicle developed an overheating warning during official duty and was stopped safely.',
  damageOrDefects: 'Coolant hose leak identified. No consequential engine damage recorded.',
  evidence: ['breakdown-front-view.jpg', 'coolant-hose-inspection.jpg'],
  responseOrAction:
    'Roadside assistance attended; hose replaced and vehicle cleared after inspection.',
  safeDetermination: 'Vehicle safe after technical clearance; all passengers safe.',
  reportedBy: 'John Shikongo',
  acknowledgedBy: 'Anna Nghikembua',
  acknowledgedAt: '2026-08-09T16:30:00+02:00',
  verificationCode: 'VER-8F34021',
  verificationUrl,
  documentHash: hash,
  qrCodeDataUrl,
};

await Promise.all([
  renderToFile(
    asPdfDocument(React.createElement(TripAuthorityDocument, { data: authority })),
    path.join(output, 'trip-authority-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(TripAuthorityDocument, { data: longAuthority })),
    path.join(output, 'trip-authority-stress.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(TransportRequestDocument, { data: request })),
    path.join(output, 'transport-request-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(ReportDocument, { data: report })),
    path.join(output, 'fuel-report-stress.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(ReportDocument, { data: tripSummaryReport })),
    path.join(output, 'trip-summary-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(InspectionReportDocument, { data: inspection })),
    path.join(output, 'inspection-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(FuelReceiptDocument, { data: fuelReceipt })),
    path.join(output, 'fuel-receipt-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(DriverLogsheetDocument, { data: driverLogsheet })),
    path.join(output, 'driver-logsheet-reference.pdf'),
  ),
  renderToFile(
    asPdfDocument(React.createElement(IncidentRecordDocument, { data: incidentRecord })),
    path.join(output, 'incident-record-reference.pdf'),
  ),
]);

console.log(`Rendered official document QA artifacts to ${output}`);
