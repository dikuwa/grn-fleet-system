export interface LicenceOcrFields {
  holderName?: string;
  dateOfBirth?: string;
  nationalIdNumber?: string;
  validFrom?: string;
  validUntil?: string;
  licenceNumber?: string;
  issueNumber?: string;
  licenceCodes: string[];
  driverRestrictionCode?: string;
  professionalCategory?: string;
  professionalExpiry?: string;
}

const datePattern = /\b(\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2})\b/g;
const licenceCodePattern = /\b(A1|A|B|C1E|C1|CE|C|BE|EB)\b/gi;

function normaliseDate(value?: string) {
  if (!value) return undefined;
  const date = value.match(/\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2}/)?.[0];
  if (!date) return undefined;
  const parts = date.replace(/[./]/g, '-').split('-');
  const [yearText, monthText, dayText] =
    parts[0].length === 4 ? parts : [parts[2], parts[1], parts[0]];
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${yearText.padStart(4, '0')}-${monthText.padStart(2, '0')}-${dayText.padStart(2, '0')}`;
}

function labelledLineValue(lines: string[], labels: RegExp[]): string | undefined {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(label);
      if (match?.[1]) return match[1].trim();
    }
  }
  return undefined;
}

function holderLicenceCodes(lines: string[]): string[] {
  const labelled = lines.filter((line) => /(?:^|\s)(?:9\.?\s*)?(?:code|codes|licence\s*code|license\s*code)\s*[:|.-]/i.test(line));
  const source = labelled.join(' ');
  if (!source) return [];
  return [...new Set([...source.toUpperCase().matchAll(licenceCodePattern)].map((match) => match[1]))];
}

export function parseNamibianLicenceOcr(text: string): LicenceOcrFields {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lines = clean.split('\n').map((line) => line.trim()).filter(Boolean);
  const dates = [...clean.matchAll(datePattern)]
    .map((match) => normaliseDate(match[1]))
    .filter(Boolean) as string[];
  const findValue = (labels: string[]) => {
    const line = lines.find((entry) => labels.some((label) => entry.toLowerCase().includes(label)));
    return line?.split(/[:|]/).slice(1).join(':').trim() || undefined;
  };

  const validityLine = lines.find((line) => /(?:validity|valid\s*(?:from|until|to)?)/i.test(line));
  const validityDates = validityLine
    ? [...validityLine.matchAll(datePattern)]
        .map((match) => normaliseDate(match[1]))
        .filter(Boolean) as string[]
    : [];

  const licenceNumber = labelledLineValue(lines, [
    /(?:licen[cs]e)\s*(?:no|number)?\s*[.:#|-]*\s*([A-Z0-9-]{4,})/i,
  ])?.replace(/\s/g, '');
  const codes = holderLicenceCodes(lines);
  const id = clean.match(/\b\d{6,13}\b/)?.[0];

  // Validity dates are deliberately label-bound. Real OCR commonly produces
  // unrelated date-like noise (for example a damaged DOB or card issue text).
  // If validity cannot be read reliably, leave it undefined so the upload flow
  // can use the user's explicit fallback rather than promoting an OCR guess.
  return {
    holderName: findValue(['surname', 'name']),
    dateOfBirth: normaliseDate(findValue(['date of birth', 'birth'])) || dates[0],
    nationalIdNumber: findValue(['identity', 'id no', 'id number'])?.replace(/\s/g, '') || id,
    validFrom: normaliseDate(findValue(['valid from'])) || validityDates[0],
    validUntil: normaliseDate(findValue(['valid until', 'expiry', 'valid to'])) || validityDates[1],
    licenceNumber: licenceNumber || findValue(['licence no', 'license no', 'licence number'])?.replace(/\s/g, ''),
    issueNumber: findValue(['issue no', 'issue number']),
    licenceCodes: codes,
    driverRestrictionCode: findValue(['driver restriction']),
    professionalCategory: findValue(['professional authorisation', 'professional authorization', 'prdp']),
    professionalExpiry: normaliseDate(findValue(['professional expiry', 'prdp expiry'])),
  };
}

export function licenceOcrConfidence(fields: LicenceOcrFields, meanConfidence: number) {
  const base = Math.max(0, Math.min(1, meanConfidence / 100));
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value && (!Array.isArray(value) || value.length) ? base : 0]),
  );
}
