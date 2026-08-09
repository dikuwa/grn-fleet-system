CREATE TABLE IF NOT EXISTS "request_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "requester_employee_id" uuid,
  "client_draft_id" text,
  "last_step" integer DEFAULT 0 NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "request_drafts"
    ADD CONSTRAINT "request_drafts_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "request_drafts"
    ADD CONSTRAINT "request_drafts_requester_employee_id_employees_id_fk"
    FOREIGN KEY ("requester_employee_id") REFERENCES "public"."employees"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_request_drafts_tenant_user_client"
  ON "request_drafts" USING btree ("tenant_id", "user_id", "client_draft_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_drafts_tenant_user_updated"
  ON "request_drafts" USING btree ("tenant_id", "user_id", "updated_at");
