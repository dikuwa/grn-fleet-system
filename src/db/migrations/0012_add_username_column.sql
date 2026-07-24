--> Add username column to user table for username-based authentication
--> This enables login with username instead of email
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" text UNIQUE;
