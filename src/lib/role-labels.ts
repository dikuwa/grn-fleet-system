/**
 * Human-readable role labels for display throughout the application.
 *
 * Maps internal role names to concise labels suitable for:
 *   - Account dropdown (role/job title display)
 *   - Profile pages
 *   - Staff directory
 *   - Approval records
 *   - Anywhere a user's role needs to be displayed
 */

export const ROLE_LABELS: Record<string, string> = {
  'Platform Super Administrator': 'Platform Administrator',
  'Requester / Programme Owner': 'Requester',
  'Immediate Supervisor': 'Supervisor',
  'Control Administrative Officer': 'Transport Officer',
  'Deputy Director': 'Deputy Director',
  'Director': 'Director',
  'Chief Regional Officer': 'Chief Regional Officer',
  'Transport Administrator': 'Transport Administrator',
  'Assigned Driver': 'Driver',
  'Inspector': 'Inspector',
  'Maintenance Officer': 'Maintenance Officer',
  'Tenant Administrator': 'Tenant Administrator',
  'Tenant Auditor': 'Auditor',
  'Platform Support Administrator': 'Platform Support',
  'Platform Auditor': 'Platform Auditor',
};

/**
 * Get a human-readable role label from a raw role name.
 * Falls back to capitalised-and-spaced version of the input.
 */
export function getRoleLabel(roleName: string): string {
  return ROLE_LABELS[roleName] || roleName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get a concise role label suitable for small badges or tight spaces.
 * Uses the first word or a known short form.
 */
export function getShortRoleLabel(roleName: string): string {
  const label = getRoleLabel(roleName);
  // Return known short forms
  const shortForms: Record<string, string> = {
    'Platform Administrator': 'Platform Admin',
    'Transport Administrator': 'Transport Admin',
    'Tenant Administrator': 'Tenant Admin',
    'Chief Regional Officer': 'CRO',
    'Control Administrative Officer': 'Admin Officer',
    'Platform Support Administrator': 'Platform Support',
  };
  return shortForms[label] || label;
}
