# Pre-Deployment Checklist

## Code quality

- [ ] Fresh `pnpm install --frozen-lockfile` succeeds
- [ ] Lint passes
- [ ] Type-check passes
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] E2E tests pass
- [ ] Production build passes
- [ ] No unused debug routes, logs or test credentials
- [ ] Bundle report reviewed; maps/PDF/charts/spreadsheets dynamically loaded

## Environment

- [ ] Production variables documented and configured
- [ ] Secrets differ from staging/local
- [ ] Auth and share secrets are at least 32 random bytes
- [ ] Browser and server Google keys are separated and restricted
- [ ] R2 bucket is private
- [ ] Resend sender/domain verified
- [ ] Sentry release configured
- [ ] WhatsApp API remains disabled
- [ ] SMS remains disabled

## Database

- [ ] Production backup taken before migration
- [ ] Migration reviewed for locks/destructive operations
- [ ] Tenant indexes present
- [ ] RLS enabled and tested
- [ ] Seed scripts cannot run accidentally in production
- [ ] Audit append-only protections enabled
- [ ] Restore rehearsal completed in staging

## Authentication and permissions

- [ ] No public registration route
- [ ] Temporary-password flow requires change
- [ ] Suspended user sessions revoked
- [ ] Cross-tenant test suite passes
- [ ] Separation-of-duties tests pass
- [ ] Platform roles cannot bypass tenant rules silently
- [ ] Admin reset and recovery documented

## External integrations

- [ ] Google Routes/Places quotas and billing alerts configured
- [ ] R2 CORS and presigned URL settings restricted
- [ ] Resend retry/failure monitoring configured
- [ ] Inngest signing keys configured
- [ ] Upstash rate limits verified
- [ ] External adapters have timeouts and graceful fallbacks

## UI/UX

- [ ] Mobile request, approval, inspection, log and fuel flows tested on real device
- [ ] All default browser selects/date controls replaced
- [ ] Loading, empty, error, offline and permission states complete
- [ ] Tables have mobile alternatives
- [ ] Document preview shows full pages
- [ ] Long names/roles/comments do not break layouts
- [ ] No unsupported government-adoption claims

## Security

- [ ] CSP and security headers enabled
- [ ] Dependency and secret scans pass
- [ ] Rate limiting on login, reset, share and verification
- [ ] Upload validation and tenant prefixes verified
- [ ] External documents use redaction profile
- [ ] Share token hashes—not raw tokens—stored
- [ ] Sensitive data absent from logs and analytics
- [ ] Audit chain verification passes

## Operations

- [ ] Monitoring alerts reach responsible team
- [ ] Background job failures visible
- [ ] Backup retention configured
- [ ] Incident and credential-rotation procedure documented
- [ ] Support contact and escalation recorded
- [ ] Tenant onboarding and offboarding rehearsed

## Smoke tests after deployment

- [ ] Login and forced password change
- [ ] Create pilot tenant user
- [ ] Submit regional request
- [ ] Supervisor approve
- [ ] Allocate vehicle
- [ ] Release and final authorise
- [ ] Issue vehicle
- [ ] Add daily log and fuel entry
- [ ] Return inspection and close trip
- [ ] Generate and securely share PDF
- [ ] Export report
- [ ] Verify cross-tenant denial
- [ ] Check Sentry and job dashboard

## Rollback

- [ ] Previous Vercel deployment identified
- [ ] Migration rollback/data restore decision documented
- [ ] Feature flags available for maps, offline drafts and external sharing
- [ ] Communication template ready for outage or rollback
