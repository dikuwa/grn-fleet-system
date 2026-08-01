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

const number = String.raw`([0-9]+(?:[.,][0-9]{1,2})?)`;

function normaliseNumber(value: string): number {
  return Number(value.replace(',', '.'));
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

/** Deterministic parser kept separate from OCR so it can be tested with real receipt samples. */
export function parseFuelReceiptText(text: string, ocrConfidence = 0): ParsedReceipt {
  const compact = text.replace(/\r/g, '');
  const lines = compact.split('\n').map((line) => line.trim()).filter(Boolean);
  const amountRaw = firstMatch(compact, [
    new RegExp(String.raw`(?:TOTAL|AMOUNT|N\$|NAD)\s*:?\s*(?:N\$|NAD)?\s*${number}`, 'i'),
  ]);
  const litresRaw = firstMatch(compact, [
    new RegExp(String.raw`(?:LITRES?|LTRS?|QTY|QUANTITY)\s*:?\s*${number}`, 'i'),
    new RegExp(String.raw`${number}\s*(?:L|LTR|LITRES?)\b`, 'i'),
  ]);
  const priceRaw = firstMatch(compact, [
    new RegExp(String.raw`(?:PRICE\/?L|P\/?L|UNIT PRICE)\s*:?\s*${number}`, 'i'),
  ]);
  const odometerRaw = firstMatch(compact, [
    /(?:ODOMETER|ODO|MILEAGE)\s*:?\s*([0-9]{2,8})/i,
  ]);
  const date = firstMatch(compact, [
    /\b([0-3]?\d[/-][01]?\d[/-](?:20)?\d{2})\b/,
    /\b((?:20)\d{2}[/-][01]\d[/-][0-3]\d)\b/,
  ]);
  const time = firstMatch(compact, [/\b([0-2]?\d:[0-5]\d(?::[0-5]\d)?)\b/]);
  const reference = firstMatch(compact, [
    /(?:TRANSACTION|TRANS|REFERENCE|REF|TERMINAL)\s*(?:NO|NUMBER|#|ID)?\s*:?\s*([A-Z0-9-]{4,})/i,
  ]);
  const receiptNumber = firstMatch(compact, [
    /(?:RECEIPT|INVOICE)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z0-9-]{3,})/i,
  ]);
  const registration = firstMatch(compact, [
    /(?:REG(?:ISTRATION)?|VEHICLE)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z]{1,4}[- ]?[A-Z0-9]{2,8})/i,
  ]);
  const vat = firstMatch(compact, [/(?:VAT)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z0-9-]{4,})/i]);
  const fuelType = firstMatch(compact, [/\b(DIESEL|PETROL|UNLEADED|ULP\s*95|ULP\s*93)\b/i]);
  const pumpNumber = firstMatch(compact, [/(?:PUMP|NOZZLE)\s*(?:NO|NUMBER|#)?\s*:?\s*([0-9A-Z]{1,4})/i]);
  const attendant = firstMatch(compact, [/(?:ATTENDANT|OPERATOR|CASHIER)\s*(?:NO|NUMBER|#)?\s*:?\s*([A-Z0-9-]{2,30})/i]);
  const cardNumber = firstMatch(compact, [/(?:CARD\s*(?:NO|NUMBER|#)?|FUEL\s*CARD)\s*:?\s*([A-Z0-9-]{6,})/i]);

  const amount = amountRaw ? normaliseNumber(amountRaw) : undefined;
  const litres = litresRaw ? normaliseNumber(litresRaw) : undefined;
  let pricePerLitre = priceRaw ? normaliseNumber(priceRaw) : undefined;
  let computedPricePerLitre: number | undefined;
  if (pricePerLitre === undefined && amount !== undefined && litres !== undefined && litres > 0) {
    computedPricePerLitre = Number((amount / litres).toFixed(2));
  }
  if (pricePerLitre === undefined && computedPricePerLitre !== undefined) pricePerLitre = computedPricePerLitre;

  const fields: ReceiptFields = {
    supplier: lines[0]?.slice(0, 120),
    transactionDate: date,
    transactionTime: time,
    transactionReference: reference,
    pumpNumber,
    receiptNumber,
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
    odometer: odometerRaw ? Number(odometerRaw) : undefined,
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
  if (fields.fuelType && !fields.fuelType.includes(input.vehicleFuelType.toLowerCase())) {
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
    Math.abs(fields.amount / fields.litres - fields.pricePerLitre) / fields.pricePerLitre > 0.1
  ) {
    flags.push('amount_litres_inconsistent');
  }
  if (fields.transactionDate) {
    const parsed = new Date(fields.transactionDate);
    if (!Number.isNaN(parsed.getTime())) {
      const lower = input.tripStart ? new Date(input.tripStart.getTime() - 24 * 60 * 60 * 1000) : null;
      const upper = input.tripEnd ? new Date(input.tripEnd.getTime() + 7 * 24 * 60 * 60 * 1000) : null;
      if ((lower && parsed < lower) || (upper && parsed > upper)) flags.push('date_outside_trip_period');
    }
  }
  return flags;
}
