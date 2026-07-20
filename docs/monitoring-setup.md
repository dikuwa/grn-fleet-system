# Monitoring & Alerting Setup Guide

> **Last updated:** 2026-07-20
> **Project:** GovFleet Namibia
> **Deployment:** https://grn-fleet-system.vercel.app

---

## 1. Sentry Error Monitoring

### Status: ✅ Configured

Sentry is configured across all three runtime environments:

| Runtime | Config File | Sample Rate | Features |
|---------|-------------|-------------|----------|
| Server | `sentry.server.config.ts` | 100% | Error tracking, performance traces |
| Edge | `sentry.edge.config.ts` | 100% | Middleware/edge route errors |
| Client | `instrumentation-client.ts` | 100% traces, 10% session replays, 100% error replays | Session Replay, Router transitions |

### Environment Variables

| Variable | Set | Purpose |
|----------|-----|---------|
| `SENTRY_DSN` | ✅ Vercel prod | DSN for error ingestion |
| `SENTRY_AUTH_TOKEN` | ✅ Vercel prod | Source map upload auth |
| `SENTRY_ORG` | ✅ Vercel prod | `flextech-media-investment-cc` |
| `SENTRY_PROJECT` | ✅ Vercel prod | GovFleet Namibia |

### Recommended Alert Rules

Configure these in the [Sentry Dashboard → Alerts](https://flextech-media-investment-cc.sentry.io/alerts/rules/):

#### Critical (Pager/Call)

| Rule | Condition | Action |
|------|-----------|--------|
| **API 5xx Spike** | >5 errors in 5 minutes on any API route | Email + Slack |
| **Auth Failure Burst** | >10 `401` / `403` responses in 5 minutes | Email + Slack |
| **Database Connection Error** | Any `NeonDbError` or connection timeout | Email + Slack |
| **Upload Failure** | Any `R2` / `S3` storage error | Email + Slack |

#### Warning (Email)

| Rule | Condition | Action |
|------|-----------|--------|
| **New Error Type** | First occurrence of a new error class | Email |
| **Slow API Route** | P95 > 5s on any API endpoint | Email |
| **High Error Rate** | >1% error rate over 10 minutes | Email |
| **Background Job Failure** | Any Inngest function error | Email |

#### Info (Digest)

| Rule | Condition | Action |
|------|-----------|--------|
| **Daily Error Summary** | 24h aggregate of all errors | Daily digest email |
| **New Unique Users Affected** | >10 unique users hit errors in a day | Daily digest |
| **Performance Regression** | Any route with >20% increase in duration | Weekly report |

### Performance Monitoring

- **Traces sample rate**: 1.0 (100%) — acceptable for current pilot scale
- **Downsample to 0.1 (10%)** when daily traffic exceeds 10,000 requests
- **Key transactions to monitor**:
  - `POST /api/transport-requests` — request creation latency
  - `POST /api/approvals/[id]/action` — approval processing time
  - `GET /api/reports` — report generation time
  - Page load transactions for dashboard, fleet, trips

### Session Replay

- **Session sample rate**: 10% (configured in `instrumentation-client.ts`)
- **On-error sample rate**: 100% (capture replay whenever an error occurs)
- **Privacy**: No sensitive form data captured (default)

---

## 2. Vercel Deployment Monitoring

### Status: ✅ Live

Production URL: https://grn-fleet-system.vercel.app

### Automatic Deployments

| Trigger | Action |
|---------|--------|
| Push to `master` | Production deploy (auto) |
| Pull Request | Preview deploy (auto) |
| Production failure | Email notification to team |

### Configured Build Checks

- TypeScript compilation (`pnpm typecheck`)
- Unit + integration tests (`pnpm test`)
- Lint (`pnpm lint`)
- Production build (`pnpm build`)

### Recommended Vercel Alert Rules

Configure in [Vercel Dashboard → Notifications](https://vercel.com/flextech-media-investments-projects/grn-fleet-system/settings/notifications):

| Event | Channel | Recipients |
|-------|---------|------------|
| **Deployment Failed** | Email | Project owner + dev team |
| **Deployment Ready** | Email (optional) | Project owner |
| **Production Domain Expiry** | Email | Billing contact |
| **Build Time > 5 min** | Email | Project owner |
| **Error Rate Spike** | Email | Project owner |

### Deployment Rollback

```bash
# List recent production deployments
vercel list --prod

# Rollback to a specific deployment
vercel rollback <deployment-url>
```

---

## 3. System Health Dashboard

### Status: ✅ Built

The [Platform Dashboard](https://grn-fleet-system.vercel.app/dashboard/platform) includes an **Environment Status** card showing:

| Service | Check | Data Source |
|---------|-------|-------------|
| Database | Connection test | `GET /api/platform/dashboard` (live DB query) |
| Background Jobs | Inngest config check | `INNGEST_EVENT_KEY` env var presence |
| Error Monitoring | Sentry DSN presence | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` env vars |
| Email | Resend config check | `RESEND_API_KEY` env var presence |

### Services Not Monitored (DORMANT)

| Service | Config Needed | Action to Enable |
|---------|---------------|------------------|
| SMS (Twilio) | Twilio Account SID, Auth Token, Phone Number | Set `TWILIO_*` env vars + `ENABLE_SMS=true` |
| SMS (Vonage) | Vonage API Key, Secret, From Number | Set `VONAGE_*` env vars + `SMS_PROVIDER=vonage` |
| Google Maps | Google billing account + API key | Set `GOOGLE_MAPS_SERVER_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` |
| WhatsApp API | Meta Business account | Set `ENABLE_WHATSAPP_API=true` |

---

## 4. Background Job Health (Inngest)

### Status: ✅ Configured

Six background job functions are registered in `src/lib/inngest/functions.ts`:

| Function | Schedule | Purpose | Tenant-Isolated |
|----------|----------|---------|-----------------|
| `step-reminder` | Every 15 min | Remind current approver of pending step | ✅ |
| `escalation` | Every 15 min | Escalate stalled approvals | ✅ |
| `approval-completed` | Event-driven | Fire post-approval actions | ✅ |
| `vehicle-licence-expiry` | Daily 06:00 | Alert on expiring vehicle licences | ✅ |
| `driver-licence-expiry` | Weekly Mon 06:00 | Alert on expiring driver licences | ✅ |
| `maintenance-reminder` | Weekly Sun 06:00 | Alert on upcoming service due | ✅ |

**Monitoring**: Check the [Inngest Dashboard](https://app.inngest.com) for:
- Failed function runs
- Function duration spikes
- Queue backlogs

---

## 5. Health Check API

A dedicated health check endpoint is available at:

```
GET /api/platform/dashboard
```

This returns:
```json
{
  "success": true,
  "data": {
    "tenants": { "total": 1, "active": 1, ... },
    "envHealth": {
      "database": true,
      "backgroundJobs": true,
      "errorMonitoring": true,
      "email": true
    }
  }
}
```

### Uptime Monitoring (Recommended)

Set up an external uptime monitor (e.g., Better Uptime, Pingdom, or UptimeRobot) to:

| Check | URL | Frequency | Expected |
|-------|-----|-----------|----------|
| Home page | `https://grn-fleet-system.vercel.app` | 5 min | 200 OK |
| Login page | `https://grn-fleet-system.vercel.app/login` | 5 min | 200 OK |
| API health | `https://grn-fleet-system.vercel.app/api/platform/dashboard` | 1 min | 200 + `success: true` |
| Database | `https://grn-fleet-system.vercel.app/api/platform/dashboard` | 1 min | `envHealth.database: true` |

---

## 6. Logging

### Server-side logs

- All API routes log errors via `console.error` with route prefix (e.g., `[inspections]`, `[Upload]`)
- Sentry captures all unhandled exceptions automatically
- Inngest function failures are logged to Inngest dashboard

### Client-side logs

- `console.log` in dev mode only (tree-shaken in production by Sentry SDK)
- Sentry captures all unhandled promise rejections and exceptions
- Session Replay captures user interactions before errors

---

## 7. Incident Response

### Severity Levels

| Level | Definition | Response Time | Channel |
|-------|------------|---------------|---------|
| P1 | Complete outage, data loss | < 1 hour | Phone + Slack |
| P2 | Major feature broken | < 4 hours | Slack |
| P3 | Minor feature broken, cosmetic | < 24 hours | Email |
| P4 | Enhancement, non-critical | Next sprint | Issue tracker |

### Quick Checks

```bash
# 1. Check Vercel deployment status
npx vercel list --prod

# 2. Check latest deployment logs
npx vercel logs --prod

# 3. Check Inngest function health
# Visit: https://app.inngest.com

# 4. Check Sentry for recent errors
# Visit: https://flextech-media-investment-cc.sentry.io
```

### Rollback Procedure

```bash
# 1. List production deployments
npx vercel list --prod

# 2. Rollback to the previous working deployment
npx vercel rollback <last-working-deployment-url>

# 3. Verify rollback
# Visit production URL and run smoke tests
```

---

## 8. Scheduled Maintenance

| Frequency | Task | Responsible |
|-----------|------|-------------|
| Daily | Check Sentry for new error types | Dev team |
| Weekly | Review Inngest function run history | Dev team |
| Weekly | Check Vercel deployment logs for warnings | Dev team |
| Monthly | Review performance trends (Sentry) | Tech lead |
| Monthly | Update dependency scan | Dev team |
| Quarterly | Rotate secrets (BETTER_AUTH_SECRET, SHARE_TOKEN_PEPPER, etc.) | Tech lead |
| Quarterly | Test backup restore procedure | DevOps |
