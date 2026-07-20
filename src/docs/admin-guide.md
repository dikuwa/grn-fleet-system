# GovFleet Namibia — Administrator Guide

> **Version:** 1.0.0  
> **Last Updated:** 2026-07-20  

---

## 1. Platform Administration

### 1.1 Platform Dashboard

Access at `/dashboard/platform` to view:
- Total tenants and active users
- Tenant status breakdown (active, suspended)
- System-wide metrics

### 1.2 Managing Tenants

**Viewing Tenants:**
1. Navigate to **Platform > Tenants**
2. Search by name or status
3. Click a tenant to view details

**Creating a Tenant:**
Use the onboard endpoint or platform UI to create a new tenant with:
- Organisation name and contact details
- Default branding configuration
- Office and department seed data
- Role definitions

**Suspending a Tenant:**
1. Open the tenant detail page
2. Click **Suspend Tenant**
3. Confirm the action
4. All tenant users lose access until reactivated

**Activating a Tenant:**
1. Open the suspended tenant detail page
2. Click **Activate Tenant**
3. Users regain access immediately

### 1.3 Role Management

**Default Roles:**
| Role | Description |
|------|-------------|
| Platform Admin | System-wide administration |
| Transport Administrator | Full fleet management |
| Transport Officer | Operational fleet tasks |
| Approver | Request approval authority |
| Driver | Trip execution |
| Requester | Trip requests |
| Fuel Attendant | Fuel management |
| Inspector | Vehicle inspections |
| Viewer | Read-only access |

**Creating Custom Roles:**
1. Navigate to **Roles & Permissions** in the sidebar
2. Click **Create Role**
3. Select permissions from 14 categories
4. Save

**Editing Roles:**
1. Click the role in the list
2. Toggle permissions in the matrix
3. System roles are protected from editing

---

## 2. User Management

### 2.1 Inviting Users

1. Navigate to **Admin > Users**
2. Click **Invite User**
3. Enter email, name, and select role
4. The user receives an email with setup instructions

### 2.2 Managing Users

From the user detail page:
- **Update Role** — Change user permissions
- **Suspend User** — Revoke access temporarily
- **Activate User** — Restore access
- **View Activity** — See user action history

---

## 3. Region Management

1. Navigate to **Admin > Regions**
2. View existing regions with active/inactive status
3. **Create** — Add a new region with name, code, and sort order
4. **Edit** — Update region details
5. **Toggle Active** — Enable or disable a region

Vehicles and offices can be assigned to regions for geographic organisation.

---

## 4. Office Management

1. Navigate to **Offices** in the sidebar
2. View the office tree structure
3. **Create Office** — Add a new office with location details
4. **Edit** — Update office information
5. **Delete** — Remove office (only if no active assignments)

---

## 5. Settings

### 5.1 General Settings
- Organisation name and contact details
- Default office and region

### 5.2 Notification Preferences
- Email notification toggles
- Quiet hours configuration

### 5.3 Security
- Session management
- Password policy

### 5.4 Branding
- Primary and accent colours
- Organisation logo
- Document footer text
- Sender name and email for notifications

---

## 6. Email Configuration

### 6.1 Prerequisites

The email system uses **Resend**. Configure in Vercel:

```
RESEND_API_KEY=re_xxx
EMAIL_FROM=notifications@yourdomain.com
```

### 6.2 Email Templates

8 React Email templates are available:

| Template | Trigger |
|----------|---------|
| Notification | General notifications |
| Request Approved | Transport request approval |
| Request Rejected | Transport request rejection |
| Vehicle Released | Vehicle allocation |
| Trip Authorised | Trip authority granted |
| Emergency Override | Emergency trip override |
| Reminder | Task reminders and escalations |
| Password Reset | User password reset |
| Account Created | New user account |

### 6.3 Delivery History

View all sent emails at **Notifications > Email History**:
- Status tracking (sent, failed, pending)
- Error summaries for debugging
- Delivery timestamps

---

## 7. Background Jobs

The system uses Inngest for scheduled jobs:

| Job | Schedule | Description |
|-----|----------|-------------|
| Step Reminder | 30 min after inactivity | Reminds approvers |
| Escalation | 24h without action | Escalates to next-level approver |
| Approval Completed | On approval | Notifies stakeholders |
| Vehicle Licence Expiry | Daily | Checks and alerts |
| Driver Licence Expiry | Daily | Checks and alerts |
| Maintenance Reminder | Weekly | Upcoming service alerts |

---

## 8. Compliance & Expiry Alerts

The expiry alerts dashboard at `/dashboard/expiry-alerts` shows:

- **Vehicle Licence Disc** — Expiry dates with colour coding
- **Roadworthy Certificates** — Upcoming and overdue
- **Insurance Documents** — Expiry tracking
- **Driver Licences** — Expiry alerts per driver

### Colour Coding
| Colour | Meaning |
|--------|---------|
| Green | Valid (60+ days remaining) |
| Amber | Expiring soon (30-59 days) |
| Red | Expiring (0-29 days) |
| Dark Red | Expired |

---

## 9. Audit Log

The audit log at `/dashboard/logs` provides:
- Searchable event history
- Filter by entity type, action, user
- Hash-chain integrity verification
- Timestamps and user attribution

---

## 10. Vehicle Compliance

The compliance page at `/dashboard/fleet/compliance` shows:
- Traffic Register Number expiry
- Roadworthy certificate status
- Insurance coverage dates
- Licence disc validity
- Colour-coded timeline view

---

## 11. Maintenance

### 11.1 Creating Maintenance Events

1. Navigate to **Fleet > Vehicle Detail > Maintenance**
2. Click **Schedule Maintenance**
3. Select service type and priority
4. Set scheduled date
5. Submit — vehicle status auto-changes to "maintenance"

### 11.2 Completing Maintenance

1. Open the maintenance event
2. Mark as complete
3. Vehicle returns to "available" status

---

## 12. Imports

### 12.1 Staff CSV Import

Import employees from CSV with:
- Upload → Column Mapping → Preview → Complete
- Duplicate detection
- Batch tracking
- Error reporting

### 12.2 Vehicle CSV Import

Import vehicles from CSV with:
- Licence number-based upsert
- 20-column template
- Auto-create import batches

---

## 13. Production Monitoring

### 13.1 Sentry Error Tracking

Configured for:
- Server-side errors (`sentry.server.config.ts`)
- Client-side errors (`sentry.client.config.ts`)
- Edge runtime errors (`sentry.edge.config.ts`)

### 13.2 Environment Variables

Key production env vars:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon Postgres connection string |
| `BETTER_AUTH_SECRET` | Session encryption |
| `RESEND_API_KEY` | Email sending |
| `EMAIL_FROM` | Sender email address |
| `NEXT_PUBLIC_APP_URL` | Application public URL |
| `SENTRY_DSN` | Error tracking |

---

## 14. Deployment

### 14.1 Vercel Production

Deployment is automated via Vercel:
- **Production Branch:** `master`
- **Build Command:** `pnpm build`
- **Framework:** Next.js 16 (Turbopack)

### 14.2 Database Migrations

Run migrations:
```bash
pnpm db:migrate
```

Generate new migration:
```bash
pnpm db:generate
```

### 14.3 Seed Data

```bash
pnpm db:seed
```

Creates:
- Platform admin user
- Kavango East tenant
- Default roles and permissions
- Demo vehicles, staff, and offices
