/**
 * Client-safe emergency contact constants and helpers.
 *
 * This module contains ONLY types, enums, and pure functions that are safe
 * to import in client components ('use client'). It does NOT import
 * '@/db' or any server-only code.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmergencyContactRole =
  | 'hospital'
  | 'police'
  | 'towing'
  | 'fire'
  | 'insurance'
  | 'internal';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMERGENCY_CONTACT_ROLES: EmergencyContactRole[] = [
  'hospital',
  'police',
  'towing',
  'fire',
  'insurance',
  'internal',
];

export function isEmergencyContactRole(value: string): value is EmergencyContactRole {
  return (EMERGENCY_CONTACT_ROLES as string[]).includes(value);
}

export function emergencyContactRoleLabel(role: EmergencyContactRole): string {
  switch (role) {
    case 'hospital':
      return 'Hospital / Ambulance';
    case 'police':
      return 'Police';
    case 'towing':
      return 'Towing / Recovery';
    case 'fire':
      return 'Fire / Rescue';
    case 'insurance':
      return 'Insurance';
    case 'internal':
      return 'Internal (Transport Office)';
    default:
      return role;
  }
}