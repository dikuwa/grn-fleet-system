-- Preserve immutable audit history when a tenant is permanently deleted.
--
-- audit_events.tenant_id remains NOT NULL and continues to carry the historical
-- tenant UUID, but it must not cascade with the live tenants table. This keeps
-- prior audit history and the permanent-deletion event available for review.

ALTER TABLE "audit_events"
  DROP CONSTRAINT IF EXISTS "audit_events_tenant_id_tenants_id_fk";
