const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  trip_authority: 'TRIP AUTHORITY',
  transport_request: 'TRANSPORT REQUEST',
  inspection_report: 'INSPECTION REPORT',
  departure_inspection: 'DEPARTURE INSPECTION',
  return_inspection: 'RETURN INSPECTION',
  trip_completion: 'TRIP COMPLETION',
  fuel_summary: 'FUEL SUMMARY',
  fuel_receipt: 'FUEL RECEIPT',
  maintenance_report: 'MAINTENANCE REPORT',
  accident_report: 'ACCIDENT REPORT',
  trip_incident_report: 'TRIP INCIDENT REPORT',
  driver_logsheet: 'DRIVER LOGSHEET',
  programme: 'PROGRAMME',
};

function cleanPart(value: unknown, fallback: string): string {
  const result = String(value ?? '')
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 72)
    .trim();
  return result || fallback;
}

export function fleetDocumentTypeLabel(documentType: string): string {
  return DOCUMENT_TYPE_LABELS[documentType] || cleanPart(documentType.replaceAll('_', ' '), 'DOCUMENT').toUpperCase();
}

export function fleetDocumentDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  return [valid.getUTCDate(), valid.getUTCMonth() + 1, valid.getUTCFullYear()]
    .map((part, index) => index < 2 ? String(part).padStart(2, '0') : String(part))
    .join('-');
}

export function referenceFromDocumentSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
  fallback: string,
): string {
  const data = snapshot || {};
  const vehicle = data.vehicle && typeof data.vehicle === 'object' && !Array.isArray(data.vehicle)
    ? data.vehicle as Record<string, unknown>
    : {};
  const tripReferences = data.tripReferences && typeof data.tripReferences === 'object' && !Array.isArray(data.tripReferences)
    ? data.tripReferences as Record<string, unknown>
    : {};
  const candidates = [
    data.reference,
    data.requestReference,
    data.authorityNumber,
    data.tripAuthority,
    tripReferences.tripAuthority,
    tripReferences.transportRequest,
    vehicle.licenceNumber,
    vehicle.registration,
    vehicle.registrationNumber,
    data.licenceNumber,
  ];
  return cleanPart(candidates.find((value) => String(value ?? '').trim()), fallback);
}

export function buildFleetPdfFilename(input: {
  documentType: string;
  date?: unknown;
  reference?: unknown;
  fallbackReference?: string;
}): string {
  const type = fleetDocumentTypeLabel(input.documentType);
  const date = fleetDocumentDate(input.date);
  const reference = cleanPart(input.reference, input.fallbackReference || 'RECORD');
  return `${type} - ${date} - ${reference}.pdf`.slice(0, 180);
}
