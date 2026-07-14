# Deployment Guide

## Environments

Use separate Local, Preview, Staging and Production configurations. Never point previews at production data.

## Prototype services

- Vercel application
- Neon Postgres
- Cloudflare R2
- Resend
- Google Maps Platform
- Upstash Redis
- Inngest
- Sentry
- Cloudflare DNS/WAF

## Deployment flow

1. Pull request runs lint, type-check, unit and integration tests.
2. Preview deployment created with isolated safe environment.
3. Merge to main deploys staging.
4. Run migration rehearsal and E2E on staging.
5. Backup production.
6. Run reviewed migration.
7. Deploy production.
8. Run smoke tests.
9. Monitor errors/jobs and roll back if needed.

## Database

Use Neon branches for previews/test where cost permits. Migration command uses direct connection. Application uses pooled connection. Never use `drizzle-kit push` against production; use committed migrations.

## Storage

Separate buckets or strong environment prefixes. Production bucket private. Configure lifecycle for abandoned import uploads and superseded temporary previews without deleting issued document evidence.

## Domain

Start with a neutral pilot domain. Tenant custom domains/subdomains are future scope. Configure Cloudflare SSL, DNS and security headers.

## Government/on-premise path

Document adapters for:

- PostgreSQL-compatible managed or self-hosted database;
- S3-compatible MinIO/object storage;
- government SMTP provider;
- self-hosted job worker;
- approved maps provider or manual route tables;
- containerised Next.js deployment.

Do not build this second deployment path until requested, but avoid vendor-specific business logic.
