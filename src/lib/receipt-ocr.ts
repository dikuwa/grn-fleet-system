export interface ReceiptFields {
  supplier?: string;
  stationLocation?: string;
  transactionDate?: string;
  transactionTime?: string;
  transactionReference?: string;
  pumpNumber?: string;
  fuelType?: string;
  amount?: number;
  currency?: string;
  litres?: number;
  pricePerLitre?: number;
  odometer?: number;
  registrationNumber?: string;
  receiptNumber?: string;
  vatNumber?: string;
  attendant?: string;
  cardNumber?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColour?: string;
  /** Derived amount ÷ litres when both are present and price is not. */
  computedPricePerLitre?: number;
}

export interface ParsedReceipt {
  fields: ReceiptFields;
  confidence: Record<string, number>;
}

// Receipt values commonly contain OCR-inserted spaces, comma decimals, thousand
// separators, or 3 decimal places for pump prices. Keep the capture permissive;
// parseReceiptNumber performs the strict normalisation afterwards.
const receiptNumber = String.raw`([0-9][0-9 .,'’]*[0-9]|[0-9])`;

function parseReceiptNumber(value: string): number | undefined {
  let raw = value
    .trim()
    .replace(/[’']/g, '')
    .replace(/\s+/g, '');
  if (!raw || !/\d/.test(raw)) return undefined;

  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator appears last is the decimal separator; the other is
    // a thousands separator (e.g. 1,234.56 or 1.234,56).
    const decimalIndex = Math.max(lastComma, lastDot);
    const decimalSeparator = raw[decimalIndex];
    const integerPart = raw.slice(0, decimalIndex).replace(/[.,]/g, '');
    const fractionPart = raw.slice(decimalIndex + 1).replace(/[.,]/g, '');
    raw = `${integerPart}.${fractionPart}`;
    if (decimalSeparator !== ',' && decimalSeparator !== '.') return undefined;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? ',' : '.';
    const separatorIndex = raw.lastIndexOf(separator);
    const decimals = raw.length - separatorIndex - 1;
    const occurrences = raw.split(separator).length - 1;

    if (occurrences > 1 && decimals === 3) {
      // 1,234,567 is overwhelmingly more likely to be grouping than a fuel
      // value with repeated decimal separators.
      raw = raw.replace(new RegExp(`\\${separator}`, 'g'), '');
    } else if (decimals >= 1 && decimals <= 3) {
      raw = `${raw.slice(0, separatorIndex).replace(/[.,]/g, '')}.${raw.slice(separatorIndex + 1)}`;
    } else {
      raw = raw.replace(/[.,]/g, '');
    }
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}

function normaliseReceiptDate(value?: string): string | undefined {
  if (!value) return undefined;
  const parts = value.replace(/[.]/g, '/').replace(/-/g, '/').split('/').map((part) => part.trim());
  if (parts.length !== 3) return undefined;

  let year: number;
  let month: number;
  let day: number;
  if (parts[0].length === 4) {
    year = Number(parts[0]);
    month = Number(parts[1]);
    day = Number(parts[2]);
  } else {
    day = Number(parts[0]);
    month = Number(parts[1]);
    const shortYear = Number(parts[2]);
    year = parts[2].length === 2 ? 2000 + shortYear : shortYear;
  }

  if (!Number.isInteger(year) || year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
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
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Deterministic parser kept separate from OCR so it can be tested with real receipt samples. */
export function parseFuelReceiptText(text: string, ocrConfidence = 0): ParsedReceipt {
  const compact = text.replace(/\r/g, '');
  const lines = compact.split('\n').map((line) => line.trim()).filter(Boolean);

  const amountRaw = firstMatch(compact, [
    new RegExp(String.raw`(?:GRAND\s+TOTAL|TOTAL\s+(?:DUE|AMOUNT)|TOTAL|AMOUNT\s+(?:DUE|PAID)|AMOUNT)\s*:?\s*(?:N\$|NAD|R)?\s*${receiptNumber}`, 'i'),
    new RegExp(String.raw`(?:N\$|NAD)\s*${receiptNumber}\s*(?:TOTAL|AMOUNT)?`, 'i'),
  ]);
  const litresRaw = firstMatch(compact, [
    new RegExp(String.raw`(?:LITRES?|LITERS?|LTRS?|QTY|QUANTITY|VOLUME)\s*:?\s*${receiptNumber}`, 'i'),
    new RegExp(String.raw`${receiptNumber}\s*(?:L|LTRS?|LITRES?|LITERS?)\b`, 'i'),
  ]);
  const priceRaw = firstMatch(compact, [
    new RegExp(String.raw`(?:PRICE\s*(?:\/|PER)\s*(?:L|LITRE|LITER)|P\s*\/\s*L|UNIT\s+PRICE|RATE)\s*:?\s*(?:N\$|NAD|R)?\s*${receiptNumber}`, 'i'),
    new RegExp(String.raw`(?:N\$|NAD|R)?\s*${receiptNumber}\s*(?:\/\s*L|PER\s+(?:LITRE|LITER))`, 'i'),
  ]);
  const odometerRaw = firstMatch(compact, [
    /(?:ODOMETER|ODO|MILEAGE|KM\s*READING)\s*:?\s*([0-9][0-9 .,'’]{1,10})/i,
  ]);
  const dateRaw = firstMatch(compact, [
    /\b([0-3]?\d[/.\-][01]?\d[/.\-](?:20)?\d{2})\b/,
    /\b((?:20)\d{2}[/.\-][01]\d[/.\-][0-3]\d)\b/,
  ]);
  const date = normaliseReceiptDate(dateRaw);
  const time = firstMatch(compact, [/\b([0-2]?\d:[0-5]\d(?::[0-5]\d)?)\b/]);
  const reference = firstMatch(compact, [
    /(?:TRANSACTION|TRANS|REFERENCE|REF|TERMINAL)\s*(?:NO|NUMBER|#|ID)?\s*:?\s*([A-Z0-9-]{4,})/i,
  ]);
  const receiptNo = firstMatch(compact, [
    /(?:RECEIPT|INVOICE|SLIP)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z0-9-]{3,})/i,
  ]);
  const registration = firstMatch(compact, [
    /(?:REG(?:ISTRATION)?|VEHICLE)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z]{1,4}[- ]?[A-Z0-9]{2,8})/i,
  ]);
  const vat = firstMatch(compact, [/(?:VAT)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z0-9-]{4,})/i]);
  const fuelType = firstMatch(compact, [/\b(DIESEL(?:\s*50)?|PETROL|UNLEADED|ULP\s*95|ULP\s*93)\b/i]);
  const pumpNumber = firstMatch(compact, [/(?:PUMP|NOZZLE)\s*(?:NO|NUMBER|#)?\s*:?\s*([0-9A-Z]{1,4})/i]);
  const attendant = firstMatch(compact, [/(?:ATTENDANT|OPERATOR|CASHIER)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z0-9-]{2,30})/i]);
  const cardNumber = firstMatch(compact, [/(?:CARD\s*(?:NO|NUMBER|#)?|FUEL\s*CARD)\s*:?\s*([A-Z0-9*-]{6,})/i]);

  // Unknown or OCR-corrupted numeric values remain undefined. In particular,
  // zero is never manufactured as a fallback because downstream fuel fields
  // are operational values and a fake zero looks like a successful extraction.
  const amount = positive(amountRaw ? parseReceiptNumber(amountRaw) : undefined);
  const litres = positive(litresRaw ? parseReceiptNumber(litresRaw) : undefined);
  let pricePerLitre = positive(priceRaw ? parseReceiptNumber(priceRaw) : undefined);
  const odometer = positive(odometerRaw ? parseReceiptNumber(odometerRaw) : undefined);

  let computedPricePerLitre: number | undefined;
  if (pricePerLitre === undefined && amount !== undefined && litres !== undefined) {
    computedPricePerLitre = Number((amount / litres).toFixed(3));
  }
  if (pricePerLitre === undefined && computedPricePerLitre !== undefined) pricePerLitre = computedPricePerLitre;

  const fields: ReceiptFields = {
    supplier: lines[0]?.slice(0, 120),
    transactionDate: date,
    transactionTime: time,
    transactionReference: reference,
    pumpNumber,
    receiptNumber: receiptNo,
    registrationNumber: registration?.toUpperCase().replace(/\s+/g, ''),
    vatNumber: vat,
    fuelType: fuelType?.toLowerCase().replace(/\s+/g, '_'),
    amount,
    currency: /(?:\bNAD\b|N\$)/i.test(compact) ? 'NAD' : undefined,
    litres,
    pricePerLitre,
    computedPricePerLitre,
    attendant,
    cardNumber,
    odometer: odometer === undefined ? undefined : Math.round(odometer),
  };

  const base = Math.max(0, Math.min(1, ocrConfidence / 100));
  const confidence = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => [key, Number((base * (key === 'supplier' ? 0.75 : 0.9)).toFixed(3))]),
  );
  return { fields, confidence };
}

export function receiptValidationFlags(input: {
  fields: ReceiptFields;
  vehicleRegistration: string;
  vehicleFuelType: string;
  vehicleTankCapacity?: number | null;
  currentOdometer: number;
  tripStart?: Date | null;
  tripEnd?: Date | null;
}): string[] {
  const flags: string[] = [];
  const { fields } = input;
  if (
    fields.registrationNumber &&
    fields.registrationNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase() !==
      input.vehicleRegistration.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  ) flags.push('registration_mismatch');
  if (fields.fuelType && input.vehicleFuelType && !fields.fuelType.includes(input.vehicleFuelType.toLowerCase())) {
    flags.push('fuel_type_mismatch');
  }
  if (fields.odometer !== undefined && fields.odometer < input.currentOdometer) {
    flags.push('odometer_regression');
  }
  if (fields.litres !== undefined && input.vehicleTankCapacity && fields.litres > input.vehicleTankCapacity * 1.1) {
    flags.push('quantity_exceeds_tank_capacity');
  }
  if (fields.amount !== undefined && fields.amount <= 0) flags.push('invalid_amount');
  if (fields.pricePerLitre !== undefined && (fields.pricePerLitre < 5 || fields.pricePerLitre > 100)) {
    flags.push('implausible_price_per_litre');
  }
  if (
    fields.amount !== undefined &&
    fields.litres !== undefined &&
    fields.litres > 0 &&
    fields.pricePerLitre !== undefined &&
    fields.pricePerLitre > 0 &&
    Math.abs(fields.amount / fields.litres - fields.pricePerLitre) / fields.pricePerLitre > 0.1
  ) {
    flags.push('amount_litres_inconsistent');
  }
  if (fields.transactionDate) {
    const parsed = new Date(`${fields.transactionDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      const lower = input.tripStart ? new Date(input.tripStart.getTime() - 24 * 60 * 60 * 1000) : null;
      const upper = input.tripEnd ? new Date(input.tripEnd.getTime() + 7 * 24 * 60 * 60 * 1000) : null;
      if ((lower && parsed < lower) || (upper && parsed > upper)) flags.push('date_outside_trip_period');
    }
  }
  return flags;
}
