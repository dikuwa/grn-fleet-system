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

export function enrichFuelReceiptFields(text: string, base: ReceiptFields): ReceiptFields {
  const clean = text.replace(/\r/g, '');
  const lines = clean.split('\n').map((line) => line.trim()).filter(Boolean);

  const transactionReference =
    base.transactionReference ||
    firstMatch(clean, [/(?:P24\s*TXID|TXID)\s*[.:#-]*\s*([A-Z0-9-]{4,})/i]);
  const pumpNumber =
    base.pumpNumber ||
    firstMatch(clean, [/(?:PUMP)\s*(?:NO|NUMBER|#)?\s*[.:#-]*\s*([0-9A-Z]{1,4})/i]);
  const registrationNumber =
    base.registrationNumber ||
    firstMatch(clean, [
      /(?:REGISTRATION|REG)\s*(?:NO|NUMBER|#)?\s*[.:#-]*\s*([A-Z]{1,4}[- ]?[A-Z0-9]{2,8})/i,
    ])?.toUpperCase().replace(/\s+/g, '');
  const attendant =
    base.attendant ||
    lineValue(clean, /^(?:ATTENDANT(?:\s*NAME)?|OPERATOR|CASHIER)\s*(?:NO|NUMBER|#)?/i);
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
