-- 0043_system_role_permission_sync.sql
-- Reconcile system-role permissions that drifted from the current
-- RoleDefinitions in src/lib/permissions.ts, and backfill the permission
-- catalog codes those roles reference.
--
-- Background:
--   role_permissions rows are seeded from RoleDefinitions at seed time. Roles
--   created (or last synced) before a definition grew are missing the newer
--   permission codes, and the `permissions` catalog itself can lack codes that
--   were added to Permissions later. Observed drift:
--     * Catalog missing: tripIncident:manage, tripIncident:report,
--       incident:complete-details, incident:investigate,
--       incident:close-investigation, incident:technical-clearance,
--       incident:insurance-update, emergencyContacts:manage,
--       platform:site-manage, platform:billing-manage, platform:reset-manage,
--       platform:demo-manage.
--     * Platform Super Administrator missing SITE_MANAGE/BILLING_MANAGE/
--       RESET_MANAGE/DEMO_MANAGE — CMS content APIs (requirePermission
--       SITE_MANAGE) return 403 for the platform admin.
--     * Tenant Administrator and Transport Administrator missing
--       TRIP_INCIDENT_MANAGE + EMERGENCY_CONTACTS_MANAGE.
--     * Assigned Driver missing TRIP_INCIDENT_REPORT.
--
--   This migration is insert-only: it adds catalog codes and role mappings
--   that are missing and NEVER deletes rows, so custom permissions granted to
--   a role by an administrator are preserved. Roles are matched by name
--   (system roles are created by name across all environments; tenant IDs and
--   role UUIDs differ). Idempotent: re-runs are no-ops.
--
--   Naming for catalog entries mirrors src/seed/index.ts.

-- 1. Backfill the permission catalog (name/description/group follow the seed).
INSERT INTO permissions (code, name, description, "group")
SELECT code, initcap(replace(replace(code, ':', ' '), '-', ' ')), 'Permission to ' || replace(replace(code, ':', ' '), '-', ' '), split_part(code, ':', 1)
FROM (VALUES
  ('tripIncident:manage'),
  ('tripIncident:report'),
  ('incident:complete-details'),
  ('incident:investigate'),
  ('incident:close-investigation'),
  ('incident:technical-clearance'),
  ('incident:insurance-update'),
  ('emergencyContacts:manage'),
  ('platform:site-manage'),
  ('platform:billing-manage'),
  ('platform:reset-manage'),
  ('platform:demo-manage')
) AS v(code)
ON CONFLICT (code) DO NOTHING;

-- 2. Reconcile system-role permissions (insert missing only).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
JOIN (
  VALUES
    ('Platform Super Administrator', 'platform:site-manage'),
    ('Platform Super Administrator', 'platform:billing-manage'),
    ('Platform Super Administrator', 'platform:reset-manage'),
    ('Platform Super Administrator', 'platform:demo-manage'),
    ('Tenant Administrator', 'tripIncident:manage'),
    ('Tenant Administrator', 'emergencyContacts:manage'),
    ('Transport Administrator', 'tripIncident:manage'),
    ('Transport Administrator', 'emergencyContacts:manage'),
    ('Assigned Driver', 'tripIncident:report')
) AS p(role_name, code) ON r.name = p.role_name
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions existing
  WHERE existing.role_id = r.id
    AND existing.permission_code = p.code
);
