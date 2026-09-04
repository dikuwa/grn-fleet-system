-- Active vehicle identity must be unique within a tenant even when concurrent
-- create requests pass the application pre-check together. Normalise whitespace
-- and case so GRN/registration variants such as "N 1234 W" and "n 1234 w"
-- cannot represent two simultaneously active fleet records.
--
-- Historical/inactive written-off records are intentionally excluded so a
-- registration can be re-used only after the previous vehicle is no longer an
-- active fleet record.

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_tenant_active_licence_normalized
  ON vehicles (tenant_id, lower(btrim(licence_number)))
  WHERE is_active = true;
