-- Schema cleanup: drop legacy vehicle columns that were replaced by migration 0004
-- These old columns exist in the DB but are no longer referenced in the TypeScript schema

ALTER TABLE vehicles DROP COLUMN IF EXISTS grn_number;
ALTER TABLE vehicles DROP COLUMN IF EXISTS registration_number;
ALTER TABLE vehicles DROP COLUMN IF EXISTS body_type;
ALTER TABLE vehicles DROP COLUMN IF EXISTS year;
