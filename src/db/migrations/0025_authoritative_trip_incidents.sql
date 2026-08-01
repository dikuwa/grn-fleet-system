ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "official_number" text;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'minor' NOT NULL;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "continuation_state" text DEFAULT 'safe_to_continue' NOT NULL;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "vehicle_safe" boolean;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "passenger_safe" boolean;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "number_injured" integer DEFAULT 0 NOT NULL;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "details_required" boolean DEFAULT false NOT NULL;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "daily_log_entry_id" uuid;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "journey_leg_reference" text;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "origin" text;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "destination" text;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "weather" text;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "road_condition" text;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "third_party_details" jsonb;
ALTER TABLE "trip_incidents" ADD COLUMN IF NOT EXISTS "notification_state" jsonb;

CREATE TABLE IF NOT EXISTS "trip_incident_sequences" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sequence_year" integer NOT NULL,
  "current_value" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_trip_incident_sequence_tenant_year"
  ON "trip_incident_sequences" ("tenant_id", "sequence_year");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_trip_incidents_tenant_number"
  ON "trip_incidents" ("tenant_id", "official_number");
CREATE INDEX IF NOT EXISTS "idx_trip_incidents_tenant_severity"
  ON "trip_incidents" ("tenant_id", "severity");

WITH numbered AS (
  SELECT id, tenant_id, occurred_at,
         row_number() OVER (PARTITION BY tenant_id, extract(year FROM occurred_at) ORDER BY occurred_at, id) AS seq
  FROM trip_incidents
  WHERE official_number IS NULL
)
UPDATE trip_incidents i
SET official_number = 'TID-' || extract(year FROM n.occurred_at)::integer || '-' || lpad(n.seq::text, 5, '0')
FROM numbered n
WHERE i.id = n.id;

INSERT INTO trip_incident_sequences (tenant_id, sequence_year, current_value)
SELECT tenant_id, extract(year FROM occurred_at)::integer, count(*)::integer
FROM trip_incidents
GROUP BY tenant_id, extract(year FROM occurred_at)::integer
ON CONFLICT (tenant_id, sequence_year)
DO UPDATE SET current_value = greatest(trip_incident_sequences.current_value, excluded.current_value), updated_at = now();
