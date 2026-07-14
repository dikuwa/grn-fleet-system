CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"group" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"office_id" uuid,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"end_date" timestamp with time zone,
	"is_acting" boolean DEFAULT false NOT NULL,
	"delegated_by_user_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"logo_url" text,
	"logo_dark_url" text,
	"primary_color" text DEFAULT '#1F4E8C',
	"accent_color" text DEFAULT '#0F766E',
	"contact_email" text,
	"contact_phone" text,
	"address" text,
	"document_footer" text,
	"sender_name" text,
	"sender_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'regional_council' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'Africa/Windhoek' NOT NULL,
	"locale" text DEFAULT 'en-NA' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_code_unique" UNIQUE("code"),
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text,
	"requires_password_change" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"head_employee_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_licences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_profile_id" uuid NOT NULL,
	"licence_number" text NOT NULL,
	"licence_class" text NOT NULL,
	"issue_date" date NOT NULL,
	"expiry_date" date NOT NULL,
	"allowed_vehicle_categories" text,
	"document_key" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"driver_status" text DEFAULT 'authorised' NOT NULL,
	"internal_authorisation_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_name" text NOT NULL,
	"file_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"expiry_date" date,
	"is_verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"title" text,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"gender" text,
	"job_title" text,
	"grade" text,
	"department_id" uuid,
	"office_id" uuid,
	"email" text,
	"phone" text,
	"employment_status" text DEFAULT 'active' NOT NULL,
	"is_driver" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"type" text DEFAULT 'constituency_office' NOT NULL,
	"code" text,
	"address" text,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" text DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"service_odometer" integer,
	"service_type" text NOT NULL,
	"description" text NOT NULL,
	"cost" numeric(12, 2),
	"vendor_name" text,
	"notes" text,
	"next_service_date" date,
	"next_service_odometer" integer,
	"document_keys" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"passenger_capacity" integer DEFAULT 5 NOT NULL,
	"cargo_capacity" text,
	"suitable_terrain" text,
	"fuel_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"trip_id" uuid,
	"inspection_id" uuid,
	"severity" text DEFAULT 'minor' NOT NULL,
	"description" text NOT NULL,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"reported_by_user_id" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_name" text NOT NULL,
	"reference_number" text,
	"issue_date" date,
	"expiry_date" date,
	"file_key" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_odometer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"odometer_value" integer NOT NULL,
	"source" text NOT NULL,
	"source_entity_type" text,
	"source_entity_id" uuid,
	"recorded_by_user_id" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"previous_status" text,
	"new_status" text NOT NULL,
	"reason" text,
	"changed_by_user_id" text NOT NULL,
	"reference_entity_type" text,
	"reference_entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"office_id" uuid,
	"grn_number" text NOT NULL,
	"registration_number" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer,
	"colour" text,
	"body_type" text,
	"fuel_type" text DEFAULT 'petrol' NOT NULL,
	"transmission" text DEFAULT 'manual' NOT NULL,
	"engine_capacity" text,
	"current_odometer" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"fuel_card_number" text,
	"fuel_card_pin" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"venue" text,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"estimated_kilometres" integer
);
--> statement-breakpoint
CREATE TABLE "request_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer,
	"uploaded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"driver_type" text NOT NULL,
	"sort_order" integer DEFAULT 1 NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"licence_validated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_passengers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"employee_id" uuid,
	"external_name" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"changed_fields" jsonb,
	"reason" text,
	"created_by_user_id" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"origin_place_id" text,
	"origin_name" text,
	"origin_coordinates" jsonb,
	"destination_place_id" text,
	"destination_name" text,
	"destination_coordinates" jsonb,
	"mapped_distance_km" integer,
	"mapped_duration_minutes" integer,
	"route_polyline" text,
	"additional_kilometres" integer DEFAULT 0 NOT NULL,
	"additional_km_reason" text,
	"total_kilometres" integer DEFAULT 0 NOT NULL,
	"calculation_timestamp" timestamp with time zone,
	"is_verified" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"requester_user_id" text NOT NULL,
	"department" text,
	"purpose" text,
	"special_authority_required" boolean DEFAULT false NOT NULL,
	"special_authority_reason" text,
	"special_authority_approved" boolean,
	"total_authorised_kilometres" integer,
	"workflow_instance_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"authorised_by_user_id" text NOT NULL,
	"authorised_by_employee_id" uuid,
	"reason" text NOT NULL,
	"evidence" text,
	"bypassed_steps" jsonb NOT NULL,
	"requires_post_trip_review" boolean DEFAULT true NOT NULL,
	"review_status" text DEFAULT 'pending',
	"review_notes" text,
	"expiry_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"action_type" text NOT NULL,
	"result" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_employee_id" uuid,
	"role_assignment_id" uuid,
	"is_acting" boolean DEFAULT false NOT NULL,
	"comment" text,
	"signature_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trip_scope" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"definition_version" integer NOT NULL,
	"current_step_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"action_type" text NOT NULL,
	"required_permission" text,
	"label" text NOT NULL,
	"description" text,
	"requires_comment" boolean DEFAULT false NOT NULL,
	"reminder_after_hours" integer DEFAULT 2,
	"escalation_after_hours" integer DEFAULT 4,
	"allows_emergency_override" boolean DEFAULT false NOT NULL,
	"separation_duty_role" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"extraction_data" jsonb,
	"extraction_confidence" numeric(4, 3),
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"transaction_at" timestamp with time zone NOT NULL,
	"station_name" text,
	"fuel_type" text NOT NULL,
	"litres" numeric(10, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"odometer_reading" integer,
	"reference_number" text,
	"payment_method" text NOT NULL,
	"fill_type" text DEFAULT 'full' NOT NULL,
	"anomaly_state" text DEFAULT 'none',
	"anomaly_notes" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_by_user_id" text,
	"recorded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_item_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"template_item_id" uuid NOT NULL,
	"result" text NOT NULL,
	"comment" text,
	"defect_id" uuid
);
--> statement-breakpoint
CREATE TABLE "inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"inspection_item_result_id" uuid,
	"file_key" text NOT NULL,
	"caption" text,
	"stage" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"claimant_employee_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"approved_by_user_id" text,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reimbursements_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "trip_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"special_authority_granted" boolean DEFAULT false NOT NULL,
	"release_reference" text,
	"authorisation_reference" text,
	"document_version" integer DEFAULT 1 NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"authorised_kilometres" integer,
	"actual_kilometres" integer,
	"kilometre_variance" integer,
	"total_fuel_litres" numeric(10, 2),
	"total_fuel_cost" numeric(12, 2),
	"missing_item_flags" jsonb,
	"review_notes" text,
	"closed_by_user_id" text NOT NULL,
	"decision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_closures_trip_id_unique" UNIQUE("trip_id")
);
--> statement-breakpoint
CREATE TABLE "trip_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid,
	"allocation_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issue_odometer" integer,
	"keys_issued" boolean DEFAULT true NOT NULL,
	"fuel_card_issued" boolean DEFAULT false NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"acknowledged_by_driver_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"client_sync_id" text,
	"driver_employee_id" uuid NOT NULL,
	"log_date" timestamp with time zone NOT NULL,
	"odometer_out" integer,
	"odometer_in" integer,
	"departure_time" timestamp with time zone,
	"arrival_time" timestamp with time zone,
	"origin" text,
	"destination" text,
	"distance_km" integer,
	"remarks" text,
	"is_synced" boolean DEFAULT false NOT NULL,
	"sync_state" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"issued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'provisional' NOT NULL,
	"recommendation_score" integer,
	"override_reason" text,
	"allocated_by_user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"trip_id" uuid,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"type" text NOT NULL,
	"odometer_reading" integer,
	"fuel_level" text,
	"inspector_user_id" text NOT NULL,
	"inspector_employee_id" uuid,
	"driver_employee_id" uuid,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"overall_pass" boolean,
	"signature_inspector" text,
	"signature_driver" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_version" integer DEFAULT 1 NOT NULL,
	"template_version" text,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"file_key" text,
	"hash" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"redaction_profile" text DEFAULT 'internal',
	"reason" text,
	"generated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"max_views" integer,
	"current_views" integer DEFAULT 0 NOT NULL,
	"redaction_profile" text DEFAULT 'external_standard' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_key" text NOT NULL,
	"column_mapping" jsonb,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0,
	"valid_rows" integer DEFAULT 0,
	"error_rows" integer DEFAULT 0,
	"committed_rows" integer DEFAULT 0,
	"imported_by_user_id" text NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_data" jsonb NOT NULL,
	"normalized_data" jsonb,
	"validation_errors" jsonb,
	"duplicate_match_id" uuid,
	"is_committed" boolean DEFAULT false NOT NULL,
	"commit_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"provider_id" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"in_app_notifications" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"emergency_bypass_quiet_hours" boolean DEFAULT true NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" uuid,
	"action_url" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_sequence" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_employee_id" uuid,
	"role_assignment_id" uuid,
	"is_acting" boolean DEFAULT false NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"correlation_id" text,
	"source_channel" text DEFAULT 'web' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"summary" text,
	"reason" text,
	"previous_hash" text,
	"event_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenant_membership_id_tenant_memberships_id_fk" FOREIGN KEY ("tenant_membership_id") REFERENCES "public"."tenant_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_licences" ADD CONSTRAINT "driver_licences_driver_profile_id_driver_profiles_id_fk" FOREIGN KEY ("driver_profile_id") REFERENCES "public"."driver_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_categories" ADD CONSTRAINT "vehicle_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_defects" ADD CONSTRAINT "vehicle_defects_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_odometer_events" ADD CONSTRAINT "vehicle_odometer_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_status_events" ADD CONSTRAINT "vehicle_status_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_activities" ADD CONSTRAINT "request_activities_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_drivers" ADD CONSTRAINT "request_drivers_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_drivers" ADD CONSTRAINT "request_drivers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_passengers" ADD CONSTRAINT "request_passengers_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_passengers" ADD CONSTRAINT "request_passengers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_revisions" ADD CONSTRAINT "request_revisions_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_routes" ADD CONSTRAINT "request_routes_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_requests" ADD CONSTRAINT "transport_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_requests" ADD CONSTRAINT "transport_requests_requester_employee_id_employees_id_fk" FOREIGN KEY ("requester_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_overrides" ADD CONSTRAINT "emergency_overrides_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_receipts" ADD CONSTRAINT "fuel_receipts_transaction_id_fuel_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."fuel_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_item_results" ADD CONSTRAINT "inspection_item_results_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_item_results" ADD CONSTRAINT "inspection_item_results_template_item_id_inspection_template_items_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."inspection_template_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_item_results" ADD CONSTRAINT "inspection_item_results_defect_id_vehicle_defects_id_fk" FOREIGN KEY ("defect_id") REFERENCES "public"."vehicle_defects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_template_items" ADD CONSTRAINT "inspection_template_items_template_id_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_transaction_id_fuel_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."fuel_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_claimant_employee_id_employees_id_fk" FOREIGN KEY ("claimant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_authorities" ADD CONSTRAINT "trip_authorities_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_authorities" ADD CONSTRAINT "trip_authorities_allocation_id_vehicle_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."vehicle_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_closures" ADD CONSTRAINT "trip_closures_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_issues" ADD CONSTRAINT "trip_issues_allocation_id_vehicle_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."vehicle_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_log_entries" ADD CONSTRAINT "trip_log_entries_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_log_entries" ADD CONSTRAINT "trip_log_entries_driver_employee_id_employees_id_fk" FOREIGN KEY ("driver_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_allocation_id_vehicle_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."vehicle_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_request_id_transport_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transport_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_template_id_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inspection_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_driver_employee_id_employees_id_fk" FOREIGN KEY ("driver_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_access_events" ADD CONSTRAINT "share_access_events_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_document_id_generated_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."generated_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;