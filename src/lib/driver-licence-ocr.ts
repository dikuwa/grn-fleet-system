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

function normaliseDate(value?: string) {
  if (!value) return undefined;
  const date = value.match(/\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2}/)?.[0];
  if (!date) return undefined;
  const parts = date.replace(/[./]/g, '-').split('-');
  if (parts[0].length === 4) return parts.join('-');
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

export function parseNamibianLicenceOcr(text: string): LicenceOcrFields {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lines = clean.split('\n').map((line) => line.trim()).filter(Boolean);
  const dates = [...clean.matchAll(datePattern)].map((match) => normaliseDate(match[1])).filter(Boolean) as string[];
  const findValue = (labels: string[]) => {
    const line = lines.find((entry) => labels.some((label) => entry.toLowerCase().includes(label)));
    return line?.split(/[:|]/).slice(1).join(':').trim() || undefined;
  };
  const codes = [...clean.toUpperCase().matchAll(/\b(A1|A|B|C1E|C1|CE|C|BE|EB)\b/g)].map((match) => match[1]);
  const id = clean.match(/\b\d{6,13}\b/)?.[0];
  return {
    holderName: findValue(['surname', 'name']),
    dateOfBirth: normaliseDate(findValue(['date of birth', 'birth'])) || dates[0],
    nationalIdNumber: findValue(['identity', 'id no', 'id number'])?.replace(/\s/g, '') || id,
    validFrom: normaliseDate(findValue(['valid from'])) || dates.at(-2),
    validUntil: normaliseDate(findValue(['valid until', 'expiry', 'valid to'])) || dates.at(-1),
    licenceNumber: findValue(['licence no', 'license no', 'licence number'])?.replace(/\s/g, ''),
    issueNumber: findValue(['issue no', 'issue number']),
    licenceCodes: [...new Set(codes)],
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
