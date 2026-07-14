# Environment Setup

Never commit real values. Use `.env.example` placeholders and validate variables at startup.

| Variable | Purpose | Required | Scope | Placeholder / source |
|---|---|---:|---|---|
| `DATABASE_URL` | Pooled Neon Postgres connection | Yes | Server | `postgresql://USER:PASSWORD@HOST/DB?sslmode=require` |
| `DATABASE_DIRECT_URL` | Direct connection for migrations | Yes | Server/CLI | Neon connection details |
| `BETTER_AUTH_SECRET` | Session/auth signing secret | Yes | Server | Generate 32+ random bytes |
| `BETTER_AUTH_URL` | Canonical auth URL | Yes | Server | `http://localhost:3000` / production URL |
| `NEXT_PUBLIC_APP_URL` | Public app origin | Yes | Client-safe | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_NAME` | Display name | Yes | Client-safe | `GovFleet Namibia` |
| `R2_ACCOUNT_ID` | Cloudflare account | Yes for uploads | Server | Cloudflare dashboard |
| `R2_ACCESS_KEY_ID` | R2 API credential | Yes | Server secret | Cloudflare R2 token |
| `R2_SECRET_ACCESS_KEY` | R2 API secret | Yes | Server secret | Cloudflare R2 token |
| `R2_BUCKET_NAME` | Private bucket | Yes | Server | `govfleet-private` |
| `R2_ENDPOINT` | S3 endpoint | Yes | Server | `https://<account>.r2.cloudflarestorage.com` |
| `RESEND_API_KEY` | Email sending | Yes in staging/prod | Server secret | Resend dashboard |
| `EMAIL_FROM` | Verified sender | Yes | Server | `GovFleet <noreply@example.gov.na>` |
| `GOOGLE_MAPS_SERVER_API_KEY` | Routes API | Yes for route calc | Server secret | Google Cloud, API-restricted |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Places/maps browser SDK | Yes for autocomplete | Client-safe but origin restricted | Google Cloud |
| `UPSTASH_REDIS_REST_URL` | Rate limiting | Yes in production | Server | Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiting token | Yes | Server secret | Upstash console |
| `INNGEST_EVENT_KEY` | Background events | Yes in production | Server secret | Inngest |
| `INNGEST_SIGNING_KEY` | Webhook verification | Yes | Server secret | Inngest |
| `SENTRY_DSN` | Error reporting | Recommended | Server/client | Sentry project |
| `SENTRY_AUTH_TOKEN` | Source-map upload | CI only | CI secret | Sentry |
| `SENTRY_ORG` | Sentry org | CI | CI | Sentry |
| `SENTRY_PROJECT` | Sentry project | CI | CI | Sentry |
| `SHARE_TOKEN_PEPPER` | Hash external share tokens | Yes | Server secret | Generate 32+ random bytes |
| `DOCUMENT_HASH_SECRET` | Optional HMAC for verification refs | Yes | Server secret | Generate independently |
| `AUDIT_CHAIN_SECRET` | Audit event HMAC pepper | Yes | Server secret | Generate independently |
| `NEXT_PUBLIC_ENABLE_OFFLINE_DRAFTS` | Driver offline draft feature flag | Yes | Client-safe | `true` |
| `ENABLE_EXTERNAL_SHARING` | Secure external links | Yes | Server | `true` |
| `ENABLE_WHATSAPP_API` | Must remain disabled | Yes | Server | `false` |
| `ENABLE_SMS` | Future adapter only | Yes | Server | `false` |
| `SMS_PROVIDER` | Future provider selector | Optional | Server | `disabled` |
| `SEED_ADMIN_EMAIL` | Local seed administrator | Local only | Server/CLI | `admin@example.test` |
| `SEED_ADMIN_PASSWORD` | Local seed password | Local only | Server/CLI secret | Never reuse in production |

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Create a local or Neon development database.
3. Create a development R2 bucket or use a local S3-compatible adapter.
4. Use Resend test mode or write emails to a local preview directory.
5. Restrict Google keys even in development.
6. Run migrations and local seed.

## Production rules

- Use separate projects/accounts for production where feasible.
- Rotate any secret pasted into chat, logs or source control.
- Never prefix server secrets with `NEXT_PUBLIC_`.
- Restrict Google browser key by production domains and server key by API/server policy.
- Configure billing alerts and quotas for Google Maps.
- Do not store secrets in tenant settings tables.
