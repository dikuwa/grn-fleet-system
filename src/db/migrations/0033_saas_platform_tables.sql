-- 0033_saas_platform_tables.sql
-- SaaS platform layer: subscription packages, billing, invitations,
-- demo sandboxes, public CMS, and tenant reset workflow tables.

-- ===========================================================================
-- ENUM TYPES
-- ===========================================================================

DO $$ BEGIN
  CREATE TYPE "package_tier" AS ENUM ('trial','starter','professional','enterprise','custom_institutional');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "package_status" AS ENUM ('active','deprecated','archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "billing_interval" AS ENUM ('monthly','quarterly','annually');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM ('pending_payment','trialing','active','past_due','grace_period','cancelled','expired','suspended','restricted','not_configured');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_billing_interval" AS ENUM ('monthly','quarterly','annually');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_method" AS ENUM ('bank_transfer','mobile_payment','card','invoice','other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_submission_status" AS ENUM ('submitted','under_review','approved','rejected','requires_more_info');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "invitation_status" AS ENUM ('pending','sent','accepted','declined','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "invitation_type" AS ENUM ('tenant_admin','department_admin','driver','inspector','custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "demo_request_status" AS ENUM ('new','qualified','scheduled','completed','converted','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "demo_sandbox_status" AS ENUM ('active','expired','converted','revoked','deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "cms_content_status" AS ENUM ('draft','published','archived','scheduled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "cms_page_type" AS ENUM ('homepage','about','services','how_it_works','pricing','faqs','contact','legal','announcements','media_library','custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "reset_request_status" AS ENUM ('draft','pending_review','approved','in_progress','completed','failed','cancelled','rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "reset_scope" AS ENUM ('temporary_data','operational','fleet','user_access','full');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- 1. SUBSCRIPTION PACKAGES (packages.ts)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "subscription_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "tier" "package_tier" NOT NULL,
  "status" "package_status" NOT NULL DEFAULT 'active',
  "price_monthly_cents" integer,
  "price_quarterly_cents" integer,
  "price_annually_cents" integer,
  "default_billing_interval" "billing_interval" NOT NULL DEFAULT 'annually',
  "max_vehicles" integer,
  "max_users" integer,
  "max_storage_gb" integer,
  "max_drivers" integer,
  "max_departments" integer,
  "max_offices" integer,
  "max_api_calls_per_month" integer,
  "features" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "trial_days" integer DEFAULT 0 NOT NULL,
  "trial_requires_payment_method" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_packages_code_unique" UNIQUE("code")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_packages_code_idx" ON "subscription_packages" ("code");

CREATE TABLE IF NOT EXISTS "package_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "package_id" uuid NOT NULL,
  "permission_code" text NOT NULL,
  "is_included" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "package_entitlements" ADD CONSTRAINT "package_entitlements_package_id_subscription_packages_id_fk"
    FOREIGN KEY ("package_id") REFERENCES "subscription_packages"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "package_addons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "price_monthly_cents" integer,
  "price_annually_cents" integer,
  "max_quantity" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "package_addons_code_unique" UNIQUE("code")
);

-- ===========================================================================
-- 2. TENANT SUBSCRIPTIONS & BILLING (subscriptions.ts)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "package_id" uuid NOT NULL,
  "status" "subscription_status" NOT NULL DEFAULT 'not_configured',
  "billing_interval" "subscription_billing_interval" NOT NULL DEFAULT 'annually',
  "price_cents" integer NOT NULL,
  "currency" text DEFAULT 'NAD' NOT NULL,
  "current_period_start" timestamp with time zone NOT NULL,
  "current_period_end" timestamp with time zone NOT NULL,
  "trial_ends_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "grace_period_ends_at" timestamp with time zone,
  "auto_renew" boolean DEFAULT true NOT NULL,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "last_payment_at" timestamp with time zone,
  "next_payment_due_at" timestamp with time zone,
  "payment_method" "payment_method",
  "payment_reference" text,
  "current_vehicles" integer DEFAULT 0 NOT NULL,
  "current_users" integer DEFAULT 0 NOT NULL,
  "current_storage_gb" integer DEFAULT 0 NOT NULL,
  "current_drivers" integer DEFAULT 0 NOT NULL,
  "current_departments" integer DEFAULT 0 NOT NULL,
  "current_offices" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_package_id_subscription_packages_id_fk"
    FOREIGN KEY ("package_id") REFERENCES "subscription_packages"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_subscriptions_tenant_idx" ON "tenant_subscriptions" ("tenant_id");

CREATE TABLE IF NOT EXISTS "payment_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subscription_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'NAD' NOT NULL,
  "payment_method" "payment_method" NOT NULL,
  "payment_reference" text,
  "paid_at" timestamp with time zone NOT NULL,
  "proof_file_key" text NOT NULL,
  "proof_file_name" text NOT NULL,
  "proof_file_size" integer NOT NULL,
  "proof_mime_type" text NOT NULL,
  "submitted_by_user_id" text NOT NULL,
  "status" "payment_submission_status" NOT NULL DEFAULT 'submitted',
  "reviewed_by_user_id" text,
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "rejection_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_subscription_id_tenant_subscriptions_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "tenant_subscriptions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_submissions_subscription_idx" ON "payment_submissions" ("subscription_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_submissions_tenant_idx" ON "payment_submissions" ("tenant_id");

CREATE TABLE IF NOT EXISTS "billing_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "billing_contact_name" text,
  "billing_contact_email" text,
  "billing_contact_phone" text,
  "billing_address_line1" text,
  "billing_address_line2" text,
  "billing_city" text,
  "billing_region" text,
  "billing_postal_code" text,
  "billing_country" text DEFAULT 'Namibia' NOT NULL,
  "tax_id" text,
  "tax_exempt" boolean DEFAULT false NOT NULL,
  "tax_exempt_certificate_url" text,
  "preferred_payment_method" "payment_method",
  "payment_instructions" text,
  "bank_account_name" text,
  "bank_name" text,
  "bank_branch_code" text,
  "bank_account_number" text,
  "bank_swift_code" text,
  "bank_reference_template" text,
  "mobile_payment_provider" text,
  "mobile_payment_number" text,
  "mobile_payment_reference_template" text,
  "notify_on_payment_due" boolean DEFAULT true NOT NULL,
  "notify_on_payment_received" boolean DEFAULT true NOT NULL,
  "notify_on_payment_overdue" boolean DEFAULT true NOT NULL,
  "notify_on_subscription_changes" boolean DEFAULT true NOT NULL,
  "grace_period_days" integer DEFAULT 14 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_settings_tenant_id_unique" UNIQUE("tenant_id")
);

DO $$ BEGIN
  ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "subscription_addons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subscription_id" uuid NOT NULL,
  "addon_id" uuid NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "price_cents" integer NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "current_period_start" timestamp with time zone NOT NULL,
  "current_period_end" timestamp with time zone NOT NULL,
  "cancelled_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "subscription_addons" ADD CONSTRAINT "subscription_addons_subscription_id_tenant_subscriptions_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "tenant_subscriptions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "subscription_addons" ADD CONSTRAINT "subscription_addons_addon_id_package_addons_id_fk"
    FOREIGN KEY ("addon_id") REFERENCES "package_addons"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_addons_subscription_addon_idx" ON "subscription_addons" ("subscription_id", "addon_id");

-- ===========================================================================
-- 3. TENANT INVITATIONS (invitations.ts)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "tenant_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "type" "invitation_type" NOT NULL DEFAULT 'tenant_admin',
  "message" text,
  "token" text NOT NULL,
  "status" "invitation_status" NOT NULL DEFAULT 'pending',
  "expires_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "invited_by_user_id" text NOT NULL,
  "invited_by_tenant_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_invitations_token_unique" UNIQUE("token")
);

DO $$ BEGIN
  ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_invitations_token_idx" ON "tenant_invitations" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_invitations_email_status_idx" ON "tenant_invitations" ("email", "status");

CREATE TABLE IF NOT EXISTS "invitation_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invitation_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "invitation_roles" ADD CONSTRAINT "invitation_roles_invitation_id_tenant_invitations_id_fk"
    FOREIGN KEY ("invitation_id") REFERENCES "tenant_invitations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_setup_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "step_status" jsonb DEFAULT '{}'::jsonb,
  "completed_steps" integer DEFAULT 0 NOT NULL,
  "total_steps" integer DEFAULT 11 NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "last_saved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resumed_from_step" integer,
  "step_data" jsonb DEFAULT '{}'::jsonb,
  "readiness_score" integer DEFAULT 0 NOT NULL,
  "is_ready" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_setup_progress_tenant_id_unique" UNIQUE("tenant_id")
);

DO $$ BEGIN
  ALTER TABLE "tenant_setup_progress" ADD CONSTRAINT "tenant_setup_progress_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- 4. DEMO REQUESTS & SANDBOXES (demo-requests.ts)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "demo_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "company" text NOT NULL,
  "job_title" text NOT NULL,
  "role" text NOT NULL,
  "industry" text,
  "user_count" integer,
  "vehicle_count" integer,
  "monthly_cost_cents" integer,
  "technical_requirements" text,
  "integration_needs" text,
  "preferred_date" timestamp with time zone,
  "preferred_time" text,
  "timezone" text,
  "contact_method" text DEFAULT 'email' NOT NULL,
  "notes" text,
  "status" "demo_request_status" NOT NULL DEFAULT 'new',
  "qualified_by_user_id" text,
  "qualified_at" timestamp with time zone,
  "scheduled_demo_at" timestamp with time zone,
  "scheduled_demo_link" text,
  "last_contact_at" timestamp with time zone,
  "next_contact_at" timestamp with time zone,
  "contact_notes" text,
  "source" text,
  "source_details" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "demo_requests_email_idx" ON "demo_requests" ("email");

CREATE TABLE IF NOT EXISTS "demo_sandboxes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "demo_request_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "package_id" uuid NOT NULL,
  "admin_user_id" text NOT NULL,
  "admin_email" text NOT NULL,
  "password_hash" text,
  "access_code" text,
  "is_password_temporary" boolean DEFAULT true NOT NULL,
  "status" "demo_sandbox_status" NOT NULL DEFAULT 'active',
  "is_active" boolean DEFAULT true NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_accessed_at" timestamp with time zone,
  "converted_to_paid_tenant_id" uuid,
  "demo_views" integer DEFAULT 0 NOT NULL,
  "demo_completions" integer DEFAULT 0 NOT NULL,
  "conversion_notes" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT "demo_sandboxes_demo_request_id_unique" UNIQUE("demo_request_id"),
  CONSTRAINT "demo_sandboxes_tenant_id_unique" UNIQUE("tenant_id")
);

DO $$ BEGIN
  ALTER TABLE "demo_sandboxes" ADD CONSTRAINT "demo_sandboxes_demo_request_id_demo_requests_id_fk"
    FOREIGN KEY ("demo_request_id") REFERENCES "demo_requests"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "demo_sandboxes" ADD CONSTRAINT "demo_sandboxes_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "demo_sandboxes" ADD CONSTRAINT "demo_sandboxes_package_id_subscription_packages_id_fk"
    FOREIGN KEY ("package_id") REFERENCES "subscription_packages"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "demo_sandboxes_tenant_idx" ON "demo_sandboxes" ("tenant_id");

CREATE TABLE IF NOT EXISTS "tenant_readiness_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "completion_percentage" integer DEFAULT 0 NOT NULL,
  "is_ready" boolean DEFAULT false NOT NULL,
  "can_activate" boolean DEFAULT false NOT NULL,
  "blocking_issues" jsonb DEFAULT '{}'::jsonb,
  "validation_passed" boolean DEFAULT false NOT NULL,
  "validation_notes" text,
  "last_validated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "tenant_readiness_checks" ADD CONSTRAINT "tenant_readiness_checks_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- 5. PUBLIC CMS (cms-content.ts)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "cms_content" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_type" "cms_page_type" NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "featured_image" text,
  "content" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "meta_data" jsonb DEFAULT '{}'::jsonb,
  "status" "cms_content_status" NOT NULL DEFAULT 'draft',
  "published_at" timestamp with time zone,
  "scheduled_for" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "is_latest" boolean DEFAULT true NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "published_by_user_id" text,
  "is_listed" boolean DEFAULT true NOT NULL,
  "nav_order" integer DEFAULT 0 NOT NULL,
  "parent_id" uuid,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_content_slug_unique" UNIQUE("slug")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cms_content_slug_idx" ON "cms_content" ("slug");
CREATE INDEX IF NOT EXISTS "cms_content_page_type_idx" ON "cms_content" ("page_type");
CREATE INDEX IF NOT EXISTS "cms_content_status_idx" ON "cms_content" ("status");

CREATE TABLE IF NOT EXISTS "cms_content_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "title" text NOT NULL,
  "content" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "meta_data" jsonb DEFAULT '{}'::jsonb,
  "status" "cms_content_status" NOT NULL,
  "published_at" timestamp with time zone,
  "published_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "cms_content_versions" ADD CONSTRAINT "cms_content_versions_content_id_cms_content_id_fk"
    FOREIGN KEY ("content_id") REFERENCES "cms_content"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "cms_content_versions_content_version_idx" ON "cms_content_versions" ("content_id", "version");

CREATE TABLE IF NOT EXISTS "cms_media" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "file_name" text NOT NULL,
  "file_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "width" integer,
  "height" integer,
  "alt" text,
  "caption" text,
  "type" text DEFAULT 'image' NOT NULL,
  "uploaded_by_user_id" text,
  "is_public" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_media_file_key_unique" UNIQUE("file_key")
);

CREATE TABLE IF NOT EXISTS "cms_faqs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" text DEFAULT 'general' NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_published" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cms_enquiries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "subject" text NOT NULL,
  "message" text NOT NULL,
  "category" text DEFAULT 'general' NOT NULL,
  "status" text DEFAULT 'new' NOT NULL,
  "assigned_to_user_id" text,
  "assigned_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "resolution" text,
  "source" text DEFAULT 'contact_form' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cms_announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "excerpt" text,
  "body" text NOT NULL,
  "author_name" text NOT NULL,
  "published_at" timestamp with time zone,
  "is_published" boolean DEFAULT false NOT NULL,
  "is_featured" boolean DEFAULT false NOT NULL,
  "featured_image" text,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_announcements_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "cms_legal_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_slug" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "published_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "effective_from" timestamp with time zone,
  "created_by_user_id" text,
  "published_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_legal_versions_page_slug_unique" UNIQUE("page_slug")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cms_legal_versions_slug_idx" ON "cms_legal_versions" ("page_slug");

CREATE TABLE IF NOT EXISTS "cms_site_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_name" text NOT NULL,
  "site_tagline" text,
  "logo_url" text,
  "favicon_url" text,
  "primary_color" text DEFAULT '#1F4E8C' NOT NULL,
  "accent_color" text DEFAULT '#0F766E' NOT NULL,
  "contact_email" text,
  "contact_phone" text,
  "address" text,
  "social_links" jsonb DEFAULT '{}'::jsonb,
  "hero_section" jsonb DEFAULT '{}'::jsonb,
  "is_under_maintenance" boolean DEFAULT false NOT NULL,
  "maintenance_message" text,
  "analytics_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ===========================================================================
-- 6. TENANT RESET WORKFLOW (reset-requests.ts)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "tenant_reset_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "scope" "reset_scope" NOT NULL,
  "reason" text NOT NULL,
  "confirmation_phrase" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "status" "reset_request_status" NOT NULL DEFAULT 'draft',
  "backup_required" boolean DEFAULT true NOT NULL,
  "backup_created" boolean DEFAULT false NOT NULL,
  "backup_location" text,
  "backup_size_bytes" integer,
  "backup_record_count" integer,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "execution_time_ms" integer,
  "reviewed_by_user_id" text,
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "approval_token" text,
  "results" jsonb DEFAULT '{}'::jsonb,
  "validation_results" jsonb DEFAULT '{}'::jsonb,
  "failure_reason" text,
  "rollback_possible" boolean DEFAULT true NOT NULL,
  "rollback_performed" boolean DEFAULT false NOT NULL,
  "rollback_completed_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "tenant_reset_requests" ADD CONSTRAINT "tenant_reset_requests_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "tenant_reset_requests_tenant_idx" ON "tenant_reset_requests" ("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_reset_requests_status_idx" ON "tenant_reset_requests" ("status");

CREATE TABLE IF NOT EXISTS "reset_request_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reset_request_id" uuid NOT NULL,
  "step_order" integer NOT NULL,
  "step_name" text NOT NULL,
  "table_name" text NOT NULL,
  "records_deleted" integer DEFAULT 0 NOT NULL,
  "records_preserved" integer DEFAULT 0 NOT NULL,
  "files_cleaned" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "error" text,
  "details" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "reset_request_steps" ADD CONSTRAINT "reset_request_steps_reset_request_id_tenant_reset_requests_id_fk"
    FOREIGN KEY ("reset_request_id") REFERENCES "tenant_reset_requests"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
