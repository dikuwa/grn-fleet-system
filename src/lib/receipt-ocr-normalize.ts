import type { ReceiptFields } from './receipt-ocr';

function match(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1]?.trim();
}

function labelledLine(text: string, pattern: RegExp): string | undefined {
  const line = text.replace(/\r/g, '').split('\n').map((value) => value.trim()).find((value) => pattern.test(value));
  return line?.replace(pattern, '').replace(/^[\s.:#-]+/, '').trim() || undefined;
}

export function normalizeStationReceiptFields(text: string, base: ReceiptFields): ReceiptFields {
  const clean = text.replace(/\r/g, '');
  const transactionReference = match(clean, /(?:P24\s*TXID|TXID)\s*[.:#-]*\s*([A-Z0-9-]{4,})/i) || base.transactionReference;
  const registrationNumber = match(clean, /(?:REGISTRATION|REG)\s*(?:NO|NUMBER|#)?\s*[.:#-]*\s*([A-Z]{1,4}[- ]?[A-Z0-9]{2,8})/i)?.toUpperCase().replace(/\s+/g, '') || base.registrationNumber;
  const attendant = labelledLine(clean, /^(?:ATTENDANT(?:\s*NAME)?|OPERATOR|CASHIER)\s*(?:NO|NUMBER|#)?/i) || base.attendant;
  const pumpNumber = match(clean, /PUMP\s*(?:NO|NUMBER|#)?\s*[.:#-]*\s*([0-9A-Z]{1,4})/i) || base.pumpNumber;
  const vehicleMake = labelledLine(clean, /^VEHICLE\s*MAKE/i) || base.vehicleMake;
  const vehicleModel = labelledLine(clean, /^VEHICLE\s*MODEL/i) || base.vehicleModel;
  const vehicleColour = labelledLine(clean, /^VEHICLE\s*COLOU?R/i) || base.vehicleColour;
  const stationLocation = base.stationLocation || clean.split('\n').map((value) => value.trim()).find((value) => /^(?:TOTAL|SHELL|ENGEN|PUMA|BP|NAMCOR)\b/i.test(value));

  return {
    ...base,
    transactionReference,
    registrationNumber,
    attendant,
    pumpNumber,
    vehicleMake,
    vehicleModel,
    vehicleColour,
    stationLocation,
  };
}
