-- Migration 0010: Add expires_at column to generated_documents for document lifecycle automation

ALTER TABLE "generated_documents" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;

-- Index for document expiry queries
CREATE INDEX IF NOT EXISTS "idx_generated_documents_expires_at" ON "generated_documents" ("expires_at");
