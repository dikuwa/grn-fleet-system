CREATE UNIQUE INDEX IF NOT EXISTS "uq_driver_licences_profile_version"
  ON "driver_licences" ("driver_profile_id", "version");
