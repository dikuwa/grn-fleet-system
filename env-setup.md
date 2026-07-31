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
| `GOOGLE_MAPS_SERVER_API_KEY` | Routes API (computeRoutes) | Yes for route calc | Server secret | Google Cloud, **IP-restricted** key |
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

## Google Maps configuration (Routes API)

The app uses the modern **Google Routes API** (`routes.googleapis.com/directions/v2:computeRoutes`) for route calculations — the legacy Distance Matrix, Geocoding and Directions JSON endpoints are **not** used and are **not enabled** on new Google Cloud projects.

### Server key (`GOOGLE_MAPS_SERVER_API_KEY`)

- **Must be IP-restricted (or unrestricted), NOT HTTP-referrer-restricted.** A referrer-restricted key is rejected for server-side calls with `API_KEY_HTTP_REFERRER_BLOCKED`, which silently breaks route calculation. In Google Cloud Console → APIs & Services → Credentials, set **Application restrictions → IP addresses** (allowlist your server/edge IPs) and leave **Website restrictions** empty for this key.
- **Enable the Routes API** (and Geocoding API for the haversine fallback) under **APIs & Services → Library** for the same project.
- The app sends the `NEXT_PUBLIC_APP_URL` origin as the `Referer` on server calls, which also satisfies a referrer-restricted key where the app origin is allow-listed — but IP restriction is the correct long-term configuration.

### Browser key (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`)

- Used for **Places Autocomplete** in the transport-request route form.
- **Should be HTTP-referrer-restricted** to the production domains (e.g. `https://app.example.gov.na/*`, `http://localhost:3000/*`).
- Must have the **Places API** enabled.

### Troubleshooting

The `/api/routes/calculate` endpoint returns a `code` field on failure:

| Code | Meaning | Fix |
|---|---|---|
| `NOT_CONFIGURED` | Key missing | Set `GOOGLE_MAPS_SERVER_API_KEY` |
| `REFERER_BLOCKED` | Key is referrer-restricted | Switch server key to IP restriction |
| `API_NOT_ENABLED` | Routes API not enabled | Enable Routes API in Cloud Console |
| `KEY_INVALID` | Key invalid/blocked | Regenerate or fix the key |
| `RATE_LIMITED` | Quota exceeded | Raise quota or wait |
| `NO_ROUTE` | No driving route found | Check place names |

When Google is unreachable, the app falls back to a straight-line (haversine) distance estimate so route entry still works.

## Production rules

- Use separate projects/accounts for production where feasible.
- Rotate any secret pasted into chat, logs or source control.
- Never prefix server secrets with `NEXT_PUBLIC_`.
- Restrict Google browser key by production domains and server key by IP policy.
- Configure billing alerts and quotas for Google Maps.
- Do not store secrets in tenant settings tables.
