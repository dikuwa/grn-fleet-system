CREATE TABLE IF NOT EXISTS "platform_backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "reset_request_id" uuid,
  "scope" text DEFAULT 'tenant_operational' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "reason" text,
  "status" text DEFAULT 'creating' NOT NULL,
  "storage_key" text,
  "checksum" text,
  "size_bytes" integer,
  "record_count" integer DEFAULT 0 NOT NULL,
  "retention_days" integer DEFAULT 30 NOT NULL,
  "expires_at" timestamp with time zone,
  "is_protected" boolean DEFAULT false NOT NULL,
  "created_by_user_id" text,
  "restored_at" timestamp with time zone,
  "restored_by_user_id" text,
  "failure_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_backups" ADD CONSTRAINT "platform_backups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_backups" ADD CONSTRAINT "platform_backups_reset_request_id_tenant_reset_requests_id_fk" FOREIGN KEY ("reset_request_id") REFERENCES "public"."tenant_reset_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_backups_tenant_idx" ON "platform_backups" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_backups_status_created_idx" ON "platform_backups" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_backups_reset_request_idx" ON "platform_backups" USING btree ("reset_request_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_backup_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "frequency" text DEFAULT 'monthly' NOT NULL,
  "retention_days" integer DEFAULT 90 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_backup_schedules" ADD CONSTRAINT "platform_backup_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_backup_schedules_due_idx" ON "platform_backup_schedules" USING btree ("enabled", "next_run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_backup_schedules_tenant_idx" ON "platform_backup_schedules" USING btree ("tenant_id");