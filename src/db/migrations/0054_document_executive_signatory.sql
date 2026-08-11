ALTER TABLE "tenant_branding"
  ADD COLUMN IF NOT EXISTS "executive_signatory_name" text,
  ADD COLUMN IF NOT EXISTS "executive_signatory_title" text DEFAULT 'Chief Executive Officer',
  ADD COLUMN IF NOT EXISTS "executive_signature_url" text;
