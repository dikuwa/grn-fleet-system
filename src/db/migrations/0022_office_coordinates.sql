-- 0022_office_coordinates.sql
-- Adds optional latitude/longitude columns to offices for fleet map + route
-- visualisation, then backfills known Kavango East office coordinates so the
-- fleet map no longer depends on a hardcoded region-centers lookup.

ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "latitude" double precision,
  ADD COLUMN IF NOT EXISTS "longitude" double precision;

-- Backfill known Kavango East offices (idempotent, only where NULL)
UPDATE "offices" SET "latitude" = -17.9255, "longitude" = 19.7530 WHERE "code" = 'HOR' AND "latitude" IS NULL;
UPDATE "offices" SET "latitude" = -17.9167, "longitude" = 19.7667 WHERE "code" = 'RUO' AND "latitude" IS NULL;
UPDATE "offices" SET "latitude" = -17.9333, "longitude" = 19.6833 WHERE "code" = 'RRW' AND "latitude" IS NULL;
UPDATE "offices" SET "latitude" = -17.9667, "longitude" = 19.8000 WHERE "code" = 'RRE' AND "latitude" IS NULL;
UPDATE "offices" SET "latitude" = -18.0667, "longitude" = 21.4167 WHERE "code" = 'MKO' AND "latitude" IS NULL;
UPDATE "offices" SET "latitude" = -17.8833, "longitude" = 19.8333 WHERE "code" = 'KPO' AND "latitude" IS NULL;
UPDATE "offices" SET "latitude" = -17.9500, "longitude" = 20.0667 WHERE "code" = 'MSO' AND "latitude" IS NULL;
UPDATE "offices" SET "latitude" = -17.6167, "longitude" = 18.6000 WHERE "code" = 'NKO' AND "latitude" IS NULL;
-- Isolation fixture tenant (Zambezi Head Office)
UPDATE "offices" SET "latitude" = -17.4917, "longitude" = 24.2750 WHERE "code" = 'ZHO' AND "latitude" IS NULL;
