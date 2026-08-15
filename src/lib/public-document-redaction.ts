export const PUBLIC_DOCUMENT_REDACTION_PROFILES = [
  'external_standard',
  'external_minimal',
  'internal',
] as const;

export type PublicDocumentRedactionProfile =
  (typeof PUBLIC_DOCUMENT_REDACTION_PROFILES)[number];

export type PublicDocumentSummaryRow = {
  label: string;
  value: string;
};

export type PublicDocumentSummary = {
  profile: PublicDocumentRedactionProfile;
  reference: string;
  rows: PublicDocumentSummaryRow[];
};

function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text || null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function addRow(rows: PublicDocumentSummaryRow[], label: string, value: unknown) {
  const text = cleanText(value);
  if (text) rows.push({ label, value: text });
}

function compactRoute(snapshot: Record<string, unknown>): string | null {
  const renderData = objectValue(snapshot.renderData);
  const routeSummary = firstText(renderData?.routeSummary, snapshot.routeSummary);
  if (routeSummary) return routeSummary;

  const routes = Array.isArray(snapshot.routes) ? snapshot.routes : [];
  const firstRoute = objectValue(routes[0]);
  if (firstRoute) {
    const origin = firstText(firstRoute.origin, firstRoute.from);
    const destination = firstText(firstRoute.destination, firstRoute.to);
    if (origin && destination) return `${origin} → ${destination}`;
  }

  const origin = firstText(renderData?.origin, snapshot.origin);
  const destination = firstText(renderData?.destination, snapshot.destination);
  return origin && destination ? `${origin} → ${destination}` : origin || destination;
}

function safeVehicle(snapshot: Record<string, unknown>): string | null {
  const renderData = objectValue(snapshot.renderData);
  const vehicle = objectValue(renderData?.vehicle) || objectValue(snapshot.vehicle);
  if (!vehicle) return firstText(snapshot.vehicleLicence, snapshot.vehicleRegisterNumber);

  const registration = firstText(
    vehicle.licenceNumber,
    vehicle.registration,
    vehicle.registrationNumber,
    snapshot.vehicleLicence,
  );
  const registerNumber = firstText(
    vehicle.vehicleRegisterNumber,
    vehicle.registerNumber,
    snapshot.vehicleRegisterNumber,
  );
  return [registration, registerNumber].filter(Boolean).join(' · ') || null;
}

function safeValidity(snapshot: Record<string, unknown>): string | null {
  const renderData = objectValue(snapshot.renderData);
  const from = firstText(
    renderData?.startAt,
    renderData?.validFrom,
    snapshot.startAt,
    snapshot.validFrom,
    snapshot.issuedAt,
  );
  const until = firstText(
    renderData?.endAt,
    renderData?.validUntil,
    snapshot.endAt,
    snapshot.validUntil,
    snapshot.closedAt,
  );
  if (from && until) return `${from} – ${until}`;
  return from || until;
}

function inspectionSummary(snapshot: Record<string, unknown>): string | null {
  const renderData = objectValue(snapshot.renderData);
  const type = firstText(renderData?.type, snapshot.type);
  const status = firstText(renderData?.status, snapshot.status);
  const overallPass = renderData?.overallPass ?? snapshot.overallPass;
  const result =
    typeof overallPass === 'boolean' ? (overallPass ? 'Passed' : 'Failed') : null;
  return [type, result, status].filter(Boolean).join(' · ') || null;
}

export function normalizePublicDocumentRedactionProfile(
  value: unknown,
): PublicDocumentRedactionProfile {
  return PUBLIC_DOCUMENT_REDACTION_PROFILES.includes(
    value as PublicDocumentRedactionProfile,
  )
    ? (value as PublicDocumentRedactionProfile)
    : 'external_standard';
}

/**
 * Build a deliberately small, human-readable public verification summary.
 *
 * External profiles are allow-list based. They never stringify arbitrary
 * snapshot objects, so adding a new internal field cannot accidentally make it
 * public. The internal profile is reserved for explicitly-created internal
 * share links and may expose a slightly richer operational summary, while the
 * full official PDF remains the source of truth for authorised internal users.
 */
export function buildPublicDocumentSummary(input: {
  documentType: string;
  documentVersion: number;
  documentStatus: string;
  snapshotData: Record<string, unknown>;
  profile: unknown;
}): PublicDocumentSummary {
  const profile = normalizePublicDocumentRedactionProfile(input.profile);
  const snapshot = input.snapshotData || {};
  const renderData = objectValue(snapshot.renderData);
  const reference =
    firstText(
      renderData?.reference,
      snapshot.authorityNumber,
      snapshot.reference,
      snapshot.requestReference,
    ) || `Version ${input.documentVersion}`;

  const rows: PublicDocumentSummaryRow[] = [];
  addRow(rows, 'Reference', reference);
  addRow(rows, 'Status', input.documentStatus);
  addRow(rows, 'Version', `v${input.documentVersion}`);

  if (profile === 'external_minimal') {
    return { profile, reference, rows };
  }

  addRow(rows, 'Request reference', firstText(renderData?.requestReference, snapshot.requestReference));
  addRow(rows, 'Purpose', firstText(renderData?.purpose, snapshot.purpose, snapshot.tripPurpose));
  addRow(rows, 'Scope', firstText(renderData?.scope, snapshot.scope));
  addRow(rows, 'Validity', safeValidity(snapshot));
  addRow(rows, 'Vehicle', safeVehicle(snapshot));
  addRow(rows, 'Route', compactRoute(snapshot));

  if (input.documentType === 'inspection_report') {
    addRow(rows, 'Inspection', inspectionSummary(snapshot));
    addRow(rows, 'Inspection date', firstText(renderData?.inspectedAt, snapshot.inspectedAt));
  }

  if (input.documentType === 'trip_completion') {
    const closure = objectValue(snapshot.closure);
    addRow(rows, 'Trip outcome', firstText(closure?.decision, snapshot.status));
  }

  if (input.documentType === 'trip_incident_report' || input.documentType === 'accident_report') {
    addRow(rows, 'Event type', firstText(snapshot.eventType));
    addRow(rows, 'Severity', firstText(snapshot.severity));
    addRow(rows, 'Occurred at', firstText(snapshot.occurredAt));
  }

  if (profile === 'internal') {
    addRow(rows, 'Department', firstText(renderData?.department, snapshot.department));
    addRow(rows, 'Total authorised kilometres', firstText(snapshot.totalAuthorisedKilometres));
    addRow(rows, 'Generated snapshot', firstText(objectValue(snapshot.documentIdentity)?.snapshottedAt));
  }

  return { profile, reference, rows };
}
