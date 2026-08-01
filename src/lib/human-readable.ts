const DOCUMENT_LABELS: Record<string, string> = {
  transport_request: 'Transport Request',
  trip_authority: 'Trip Authority',
  vehicle_allocation: 'Vehicle Allocation Record',
  fuel_summary: 'Fuel Summary',
  inspection_report: 'Inspection Report',
  trip_completion: 'Trip Completion Report',
  maintenance_report: 'Maintenance Report',
  vehicle_history: 'Vehicle History',
  audit_report: 'Audit Report',
  defect_report: 'Defect Report',
  trip_incident_report: 'Trip Incident / Accident / Defect Report',
  accident_report: 'Motor Vehicle Accident Report',
  reimbursement: 'Reimbursement Record',
};

const EMPTY_LABELS = new Set(['', 'null', 'undefined']);

export function humanizeKey(value: string): string {
  if (DOCUMENT_LABELS[value]) return DOCUMENT_LABELS[value];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function documentTypeLabel(value: string): string {
  return DOCUMENT_LABELS[value] || humanizeKey(value);
}

export function formatDocumentStatus(value: string): string {
  return humanizeKey(value || 'draft');
}

export function formatMoney(value: unknown, locale = 'en-NA'): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not estimated';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'NAD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
  })
    .format(amount)
    .replace(/^NAD\s?/, 'N$ ');
}

export function formatHumanDate(value: unknown, locale = 'en-NA'): string {
  if (!value) return 'Not recorded';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return humanizeKey(String(value));
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatHumanDateTime(value: unknown, locale = 'en-NA'): string {
  if (!value) return 'Not recorded';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return humanizeKey(String(value));
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function formatHumanValue(value: unknown, key = ''): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (/amount|cost|price|reimbursement/i.test(key)) return formatMoney(value);
    if (/kilomet|distance|odometer/i.test(key)) return `${value.toLocaleString('en-NA')} km`;
    if (/fuel|litre|volume/i.test(key)) return `${value.toLocaleString('en-NA')} L`;
    return value.toLocaleString('en-NA');
  }
  if (Array.isArray(value))
    return value.length ? `${value.length} record${value.length === 1 ? '' : 's'}` : 'No records';
  if (typeof value === 'object') {
    const count = Object.keys(value as Record<string, unknown>).length;
    return count ? `${count} detail${count === 1 ? '' : 's'}` : 'No details';
  }
  const text = String(value).trim();
  if (EMPTY_LABELS.has(text.toLowerCase())) return 'Not recorded';
  if (isUuid(text)) return `Reference …${text.slice(-8).toUpperCase()}`;
  if (/date|time|at$/i.test(key) && !Number.isNaN(new Date(text).getTime())) {
    return formatHumanDateTime(text);
  }
  if (/status|type|scope|role|action|state|preference/i.test(key)) return humanizeKey(text);
  return text;
}

export interface HumanReadableAuditEvent {
  eventType: string;
  action: string;
  entityType: string;
  summary?: string | null;
  actorName?: string | null;
  reference?: string | null;
}

export function formatAuditEvent(event: HumanReadableAuditEvent): {
  title: string;
  description: string;
} {
  const actor = event.actorName || 'GovFleet';
  const entity = documentTypeLabel(event.entityType);
  const rawAction = humanizeKey(event.action.replaceAll('.', '_'));
  const entityPrefix = humanizeKey(event.entityType);
  const actionPrefixes = [entityPrefix, ...entityPrefix.split(' ')]
    .filter((prefix) => rawAction.toLowerCase().startsWith(`${prefix.toLowerCase()} `))
    .sort((left, right) => right.length - left.length);
  const action = actionPrefixes[0] ? rawAction.slice(actionPrefixes[0].length + 1) : rawAction;
  const reference = event.reference ? ` ${event.reference}` : '';
  return {
    title: `${actor} ${action.toLowerCase()} ${entity}${reference}`,
    description:
      event.summary?.trim() ||
      `${entity}${reference} was updated through the ${humanizeKey(event.eventType)} workflow.`,
  };
}
