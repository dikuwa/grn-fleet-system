# GovFleet Namibia Platform Tenant Onboarding & Subscription System Implementation

## Context
The current GovFleet Namibia codebase has a minimal foundation for tenant management but lacks the sophisticated platform tenant onboarding, subscription management, demo workflows, and data-reset systems required for a production SaaS offering. The existing tenant table has subscription fields (`status`, `planCode`, `subscriptionStatus`, `trialEndsAt`, `vehicleLimit`, `userLimit`, `storageLimit`) but no actual subscription management system, package management, invitation workflow, or comprehensive reset capability.

The implementation needs to create a complete multi-tenant SaaS platform with:
- Platform administrator tenant onboarding wizard
- Tenant administrator setup wizard
- Subscription package management with billing workflow
- Demo request and sandbox system
- Public website CMS
- Sophisticated tenant data reset with safety controls
- Comprehensive audit trails and tenant isolation

## Problem Summary
Current implementation is missing:
1. Platform tenant onboarding wizard (organization → primary contact → tenant admin → subscription → branding → review → create)
2. Tenant administrator invitation system
3. Tenant administrator setup wizard (account → org profile → branding → offices → departments → staff → users/roles → approval workflow → fleet → drivers → readiness check → submit)
4. Subscription package management with trial/starter/professional/enterprise tiers
5. Manual payment workflow with proof upload and Platform Admin approval
6. Billing settings configuration
7. Public website CMS with structured content management
8. Demo request and sandbox system
9. Comprehensive tenant data reset with safety controls and audits
10. Tenant lifecycle status management (Draft → Pending Invitation → Setup In Progress → Ready for Activation → Active → Suspended → etc.)

## Solution Approach
This will be a phased implementation building on the existing foundation:

### Phase 1: Core Data Model Enhancements
- Add package management table with entitlements
- Add subscription records linking tenants to packages
- Add payment submissions table with manual payment workflow
- Add invitation system with secure tokens
- Add demo request table with sandbox tracking
- Add CMS content table with version control

### Phase 2: Platform Tenant Onboarding
- Implement platform tenant onboarding wizard (5-step process)
- Add validation for uniqueness, safety checks
- Create secure invitation system for Tenant Administrators
- Implement tenant lifecycle status tracking
- Add tenant readiness validation and blocking logic

### Phase 3: Tenant Administrator Setup
- Implement tenant setup wizard (8-step process)
- Add staff management with CSV import support
- Add user-role assignment system
- Implement approval workflow configuration
- Add fleet and driver management
- Create readiness checks with critical paths

### Phase 4: Subscription Management
- Implement package CRUD with entitlements
- Add subscription lifecycle management (trial → active → grace → restricted → expired)
- Create manual payment workflow with Platform Admin approval
- Implement billing settings configuration
- Add package upgrade/downgrade logic

### Phase 5: Demo & Public Website
- Implement demo request system with qualification
- Create isolated demo sandbox tenant creation
- Build public website CMS with structured content
- Add public website navigation and publishing workflow
- Implement homepage content management

### Phase 6: Reset System
- Design comprehensive tenant-scoped reset system
- Implement safety controls with dry-run and backup
- Create multi-tier reset operations (temporary-data → operational → fleet → user-access → full)
- Add audit trail and confirmation workflow
- Implement restore capability

## Critical Path Analysis

### Must-Have for Minimum Viable Product:
1. Tenant onboarding wizard (Platform Admin)
2. Tenant invitation system
3. Tenant setup wizard (Tenant Admin)
4. Basic subscription packages (Trial, Starter, Professional, Enterprise)
5. Payment submission workflow
6. Tenant lifecycle status tracking
7. Basic CMS for public website
8. Demo request system

### Should-Have for Production Readiness:
1. Comprehensive entitlement system (vehicle/user/storage limits)
2. Full payment workflow (bank transfer, mobile payment)
3. Sophisticated reset system with safety controls
4. Advanced approval workflow configuration
5. Billing settings management
6. Tenant isolation enforcement at all levels
7. Complete audit trail for all critical actions
8. Public website publishing workflow

## Files to Create/Modify

### New Core Files:
- `src/db/schema/packages.ts` - Package management table
- `src/db/schema/subscriptions.ts` - Tenant subscriptions
- `src/db/schema/invitations.ts` - Secure invitation system
- `src/db/schema/demo-requests.ts` - Demo request tracking
- `src/db/schema/cms-content.ts` - Content management system
- `src/db/schema/payment-submissions.ts` - Manual payment tracking
- `src/db/schema/reset-requests.ts` - Tenant reset workflow

### Enhanced Existing Files:
- `src/db/schema/tenants.ts` - Add onboarding fields, invitation tracking
- `src/app/api/platform/tenants/route.ts` - Expand with invitation and subscription management
- `src/app/api/platform/onboard/route.ts` - Add comprehensive onboarding wizard
- `src/app/api/platform/subscriptions/route.ts` - Full subscription lifecycle management
- `src/app/api/platform/payments/route.ts` - Manual payment workflow
- `src/app/api/platform/demo-requests/route.ts` - Demo request and sandbox management
- `src/app/api/platform/cms/route.ts` - Public website content management
- `src/app/api/platform/reset-requests/route.ts` - Tenant reset workflow
- `src/components/ui/` - Add new UI components (wizard, cards, status badges, empty states)
- `src/lib/` - Add services (packages, subscriptions, invitations, entitlements, reset)
- `src/app/(dashboard)/dashboard/platform/` - Expand with all Platform Admin features
- `src/app/(dashboard)/dashboard/platform/onboard/` - Onboarding management
- `src/app/(dashboard)/dashboard/platform/subscriptions/` - Subscription management
- `src/app/(dashboard)/dashboard/platform/payments/` - Payment management
- `src/app/(dashboard)/dashboard/platform/demo/` - Demo management
- `src/app/(dashboard)/dashboard/platform/cms/` - CMS management

### Migration Files:
- `src/db/migrations/0033_add_packages_table.sql`
- `src/db/migrations/0034_add_subscriptions_table.sql`
- `src/db/migrations/0035_add_invitations_table.sql`
- `src/db/migrations/0036_add_demo_requests_table.sql`
- `src/db/migrations/0037_add_cms_content_table.sql`
- `src/db/migrations/0038_add_payment_submissions_table.sql`
- `src/db/migrations/0039_add_reset_requests_table.sql`

## Technical Requirements

### Data Model:
- Tenant has one subscription (1:N)
- Subscription belongs to one package (N:1)
- Package has multiple entitlements (1:N)
- Invitations are single-use, email-bound, tenant-scoped
- Demo requests create sandbox tenants (1:1)
- Payment submissions linked to subscriptions (1:N)
- CMS content is hierarchical with version control
- Reset requests are tenant-scoped with multi-tier operations

### Permissions:
- Platform Admin: Full tenant lifecycle management
- Tenant Admin: Own tenant setup and configuration
- System Admin: Override restrictions, approve payments
- Users: Access only to their tenant and role entitlements

### Security:
- Tenant isolation at database and API levels
- Secure invitation tokens (cryptographic random)
- Payment details never stored in plaintext
- Reset operations require confirmation and backup
- Public website access control

### Validation:
- All tenant creation requires unique codes/slugs
- Package entitlements must be positive integers or null (unlimited)
- Invitation tokens expire after configurable period
- Payment proof validation before activation
- Reset operations validate backup before execution

### Audit:
- All critical actions logged with actor, timestamp, tenant, action, target, previous/new values
- Sensitive data (passwords, tokens, payment credentials) excluded from audit
- Import operations logged with success/failure counts
- Reset operations log deleted/archived/preserved records

## Testing Strategy

### Automated Tests:
- Unit tests for all new services and utilities
- Integration tests for tenant lifecycle operations
- Permission tests for role-based access control
- End-to-end tests for user workflows (onboarding, payments, reset)
- Cross-tenant isolation tests
- Package entitlement enforcement tests

### Manual QA:
- Platform Admin onboarding flow testing
- Tenant Admin setup wizard testing
- Public website publishing testing
- Payment approval workflow testing
- Reset operation safety testing

## Migration Plan

### Phase 1 (Foundation):
- Create package management table
- Create subscription records
- Add basic invitation system
- Update tenant schema with onboarding fields

### Phase 2 (Platform Features):
- Implement platform onboarding wizard
- Add subscription package CRUD
- Create demo request system
- Build basic CMS

### Phase 3 (Advanced Features):
- Implement payment workflow
- Add comprehensive reset system
- Build tenant setup wizard
- Add advanced entitlement management

### Phase 4 ( polish):
- Add internationalisation support
- Implement responsive design patterns
- Add accessibility compliance
- Create documentation and help system

## Success Metrics

### Functional:
- Platform Admin can create tenant with full package selection
- Tenant Admin can complete setup wizard without Platform Admin intervention
- Payment workflow processes successfully with audit trail
- Reset operations preserve critical data while removing operational data
- Public website updates reflect immediately after publishing

### Performance:
- Tenant queries complete in <100ms
- Onboarding wizard completes in <2 minutes
- Payment approval workflow <5 minutes average
- Reset operations <30 minutes for large tenants

### Security:
- Zero cross-tenant data access incidents
- All sensitive data encrypted at rest
- All critical actions auditable
- No single points of failure

## Risk Mitigation

### High Risk:
- **Data corruption during reset**: Implement dry-run, backup validation, rollback capability
- **Cross-tenant data leakage**: Enforce tenant isolation at all layers (database, API, middleware)
- **Package entitlement misconfiguration**: Require manual review for custom packages

### Medium Risk:
- **Payment workflow complexity**: Start with manual upload, add automated later
- **Tenant onboarding user experience**: Iterative UI testing with real users
- **Performance under load**: Load testing for large tenant counts

### Low Risk:
- **Feature adoption**: Provide documentation and training materials
- **Internationalization**: Support for multiple languages and locales
- **Integration with existing systems**: Maintain backward compatibility

## Implementation Timeline

This is a comprehensive system requiring multiple months of implementation. The core tenant onboarding and subscription management can be delivered in ~3 months, with advanced features (reset system, CMS) following in additional 1-2 month phases.

## Conclusion

This implementation transforms GovFleet Namibia from a basic fleet management platform into a sophisticated multi-tenant SaaS platform suitable for government organizations. The new system provides complete lifecycle management, comprehensive auditing, and production-ready tenant isolation while maintaining simplicity for end users.

The existing codebase provides a solid foundation for this expansion, reducing development risk and ensuring consistency with current architecture patterns.