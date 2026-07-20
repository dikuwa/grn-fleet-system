CREATE TABLE IF NOT EXISTS "programme_activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "request_id" uuid REFERENCES "transport_requests"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "description" text,
  "venue" text,
  "budget_code" text,
  "start_date" timestamp with time zone NOT NULL,
  "end_date" timestamp with time zone NOT NULL,
  "estimated_cost" integer,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
