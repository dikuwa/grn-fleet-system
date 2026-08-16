export const VEHICLE_DOCUMENT_TYPES = [
  ['registration', 'Registration / NATIS'],
  ['roadworthy', 'Roadworthy Certificate'],
  ['licence_disc', 'Vehicle Licence / Road Disk'],
  ['insurance', 'Insurance'],
  ['service_document', 'Service Document'],
  ['repair_invoice', 'Repair Invoice'],
  ['maintenance_report', 'Maintenance Report'],
  ['accident_report', 'Accident Report'],
  ['traffic_fine', 'Traffic Ticket / Fine'],
  ['warranty', 'Warranty'],
  ['procurement', 'Purchase / Procurement Document'],
  ['inspection_certificate', 'Inspection Certificate'],
  ['ownership', 'Ownership Document'],
  ['vehicle_transfer', 'Vehicle Transfer'],
  ['other', 'Other'],
] as const;

export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number][0];
export const VEHICLE_DOCUMENT_TYPE_SET = new Set<string>(VEHICLE_DOCUMENT_TYPES.map(([value]) => value));
export const VEHICLE_DOCUMENT_LABELS = Object.fromEntries(VEHICLE_DOCUMENT_TYPES) as Record<string, string>;

export function vehicleDocumentExpiryState(expiryDate: string | Date | null, now = new Date()) {
  if (!expiryDate) return 'not_applicable' as const;
  const expiry = new Date(expiryDate);
  const remainingDays = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
  if (remainingDays < 0) return 'expired' as const;
  if (remainingDays <= 30) return 'expiring_soon' as const;
  return 'valid' as const;
}
