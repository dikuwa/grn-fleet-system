import type { ReceiptFields } from './receipt-ocr';

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function lineValue(text: string, label: RegExp): string | undefined {
  const line = text
    .replace(/\r/g, '')
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => label.test(entry));
  if (!line) return undefined;
  return line.replace(label, '').replace(/^[\s.:#-]+/, '').trim() || undefined;
}

function usableBase(value: string | undefined, invalid: RegExp): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || invalid.test(trimmed)) return undefined;
  return trimmed;
}

export function enrichFuelReceiptFields(text: string, base: ReceiptFields): ReceiptFields {
  const clean = text.replace(/\r/g, '');
  const lines = clean.split('\n').map((line) => line.trim()).filter(Boolean);

  const transactionReference =
    usableBase(base.transactionReference, /^(?:txid|id|ref|reference|no|number)$/i) ||
    firstMatch(clean, [/(?:P24\s*TXID|TXID)\s*[.:#-]*\s*([A-Z0-9-]{4,})/i]);

  const normalizedPump = lineValue(clean, /^PUMP\s*(?:NO|NUMBER|#)?\b/i)?.match(/[0-9A-Z]{1,4}/i)?.[0];
  const pumpNumber =
    usableBase(base.pumpNumber, /^(?:pump|no|number|#|pump\s*no)$/i) || normalizedPump;

  const normalizedRegistration = lineValue(
    clean,
    /^(?:REGISTRATION|REG)\s*(?:NO|NUMBER|#)?\b/i,
  )
    ?.replace(/[^A-Z0-9-]/gi, '')
    .toUpperCase();
  const registrationNumber =
    usableBase(
      base.registrationNumber,
      /^(?:istration|registration|reg|no|number|registration\s*no)$/i,
    )?.replace(/[^A-Z0-9-]/gi, '').toUpperCase() || normalizedRegistration;

  const attendant =
    usableBase(base.attendant, /^(?:attendant|name|operator|cashier|no|number)$/i) ||
    lineValue(clean, /^(?:ATTENDANT(?:\s*NAME)?|OPERATOR|CASHIER)\s*(?:NO|NUMBER|#)?\b/i);

  const vehicleMake = base.vehicleMake || lineValue(clean, /^VEHICLE\s*MAKE/i);
  const vehicleModel = base.vehicleModel || lineValue(clean, /^VEHICLE\s*MODEL/i);
  const vehicleColour = base.vehicleColour || lineValue(clean, /^VEHICLE\s*COLOU?R/i);
  const stationLocation =
    base.stationLocation ||
    lines.find((line) => /^(?:TOTAL|SHELL|ENGEN|PUMA|BP|NAMCOR)\b/i.test(line));

  return {
    ...base,
    stationLocation,
    transactionReference,
    pumpNumber,
    registrationNumber,
    attendant,
    vehicleMake,
    vehicleModel,
    vehicleColour,
  };
}
