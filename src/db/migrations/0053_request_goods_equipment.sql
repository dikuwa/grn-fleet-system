CREATE TABLE IF NOT EXISTS "request_goods_equipment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL REFERENCES "transport_requests"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity" text,
  "purpose" text,
  "sort_order" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_request_goods_equipment_request"
  ON "request_goods_equipment" ("request_id", "sort_order");
