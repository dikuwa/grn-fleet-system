# GovFleet Namibia — Administrator Guide

> **Version:** 1.0  
> **Last Updated:** 2026-07-20  
> **App URL:** https://grn-fleet-system.vercel.app

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Platform Administration](#2-platform-administration)
3. [Tenant Management](#3-tenant-management)
4. [User Management](#4-user-management)
5. [Roles & Permissions](#5-roles--permissions)
6. [Organisation Setup](#6-organisation-setup)
7. [Fleet Management](#7-fleet-management)
8. [Driver Management](#8-driver-management)
9. [Expiry Alerts & Compliance](#9-expiry-alerts--compliance)
10. [Bulk Imports](#10-bulk-imports)
11. [Settings](#11-settings)
12. [Reports & Audit](#12-reports--audit)
13. [Background Jobs](#13-background-jobs)
14. [Security](#14-security)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Introduction

GovFleet Namibia is a multi-tenant fleet management system for the Ministry of Works & Transport. This guide is for system administrators and tenant administrators who manage organisations, users, vehicles, and system configuration.

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Public Pages                       │
│         Landing · Login · Contact · Privacy          │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│             Platform Admin Dashboard                 │
│   Tenant Management · System-wide Reports · Audit    │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│              Tenant Dashboard                        │
│ Requests · Approvals · Trips · Fleet · Staff · Docs  │
└──────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- **Database:** Neon Postgres (serverless)
- **ORM:** Drizzle ORM
- **Auth:** Better Auth (password-based)
- **Background Jobs:** Inngest (optional)
- **File Storage:** Cloudflare R2 (optional)
- **Email:** Resend (optional)
- **Deployment:** Vercel

---

## 2. Platform Administration

### Accessing Platform Admin

Click **Platform** in the sidebar or navigate to `/dashboard/platform`.

### Dashboard Overview

The platform dashboard shows:
- **Total Tenants** — number of registered organisations
- **Active Trips** — across all tenants
- **Active Vehicles** — fleet-wide count
- **Total Users** — combined user count

### Tenant List

All tenants are listed with:
- Name and reference code
- Status (Active/Suspended)
- Join date
- User count
- Actions (View, Suspend, Activate)

### Creating a New Tenant

Use the **Onboard** page to create a new tenant:
1. Fill in organisation details (name, code, domain, email)
2. Configure branding (logo, colours)
3. Set up default offices and departments
4. Define roles with permissions
5. Configure workflow defaults
6. Submit — the system creates everything automatically

The onboard process creates:
- Tenant record with configuration
- Default offices and departments
- 9 default roles with full permission sets
- 2 workflow definitions (regional + national)
- Admin user account

---

## 3. Tenant Management

### Tenant Detail Page

Access via **Platform → Tenants → [Tenant Name]**

#### Information Tab
- Organisation details and branding
- Contact information
- Status badge (Active/Suspended)
- Logo URLs (light and dark variants)

#### Suspending a Tenant

1. Click **Suspend Tenant** on the detail page
2. Confirm the action
3. All users from that tenant lose access immediately

To re-activate, click **Activate Tenant**.

### Branding Configuration

Tenants can customise:
- Primary colour (affects buttons, links, header)
- Accent colour (affects highlights)
- Logo image (light mode)
- Logo image (dark mode)
- Document footer text
- Email sender name and address

---

## 4. User Management

### User Types

| Type | Description |
|------|-------------|
| **Platform Admin** | Manages tenants and system-wide settings |
| **Tenant Admin** | Manages users, roles, and settings within a tenant |
| **Staff** | Regular users who submit requests and use the system |

### Inviting Users

1. Go to **Administration → Users**
2. Click **Invite User**
3. Enter email, name, and select a role
4. Submit — the user receives an email with setup instructions

### Managing Users

From the user list:
- **View details** — See user info, role, status, last login
- **Edit role** — Change user's role
- **Suspend/Activate** — Control access
- **View activity** — See user's audit trail

---

## 5. Roles & Permissions

### Default Roles

The system ships with 9 default roles:

| Role | Description |
|------|-------------|
| **System Administrator** | Full system access |
| **Senior Manager** | Management-level access |
| **Transport Manager** | Manages transport operations |
| **Transport Officer** | Day-to-day transport tasks |
| **Fleet Manager** | Manages vehicles |
| **Driver** | Assigned driver access |
| **Finance Officer** | Financial reports and reimbursements |
| **Requester** | Can submit transport requests |
| **Viewer** | Read-only access |

### Permission Groups (14)

| Group | Permissions |
|-------|-------------|
| Requests | Create, view, edit, cancel, approve |
| Allocations | Create, view, edit |
| Trips | Create, view, edit, close |
| Fleet | View, create, edit, manage |
| Drivers | View, create, edit |
| Inspections | Perform, view |
| Fuel | Create, view |
| Reports | View, export |
| Documents | View, create, manage |
| Notifications | View, manage |
| Users | View, create, edit, manage |
| Roles | View, create, edit |
| Settings | View, edit |
| Platform | View, manage |

### Creating Custom Roles

1. Go to **Administration → Roles**
2. Click **Create Role**
3. Enter name and description
4. Select permissions from the matrix (all 14 groups)
5. Save

### System Roles

Some roles are marked as **System Roles** and cannot be deleted — their names and descriptions are locked.

---

## 6. Organisation Setup

### Offices

1. Go to **Administration → Offices**
2. Click **Add Office**
3. Enter name, code, physical address, contact info
4. Set active status

Offices can be organised in a hierarchy (parent/child).

### Departments

1. Go to **Administration → Departments**
2. Click **Add Department**
3. Enter name and code

### Regions

1. Go to **Administration → Regions**
2. Click **Create Region**
3. Enter name, code, description, sort order
4. Regions are used for vehicle assignment and reporting

---

## 7. Fleet Management

### Adding Vehicles

1. Go to **Fleet** in the sidebar
2. Click **Add Vehicle**
3. Enter vehicle details:
   - Licence number, vehicle register number
   - Make, model, series
   - VIN, engine number
   - Year of manufacture
   - Category (sedan, SUV, truck, bus, etc.)
   - Drive type
   - Tare weight, GVM
   - Seated and standing capacity
   - Assigned region and office
4. Save

### Vehicle Detail

The vehicle detail page has 6 tabs:
- **Overview** — Basic info and status
- **Documents** — Licence disc, roadworthy, insurance
- **Maintenance** — Service history
- **Fuel** — Fuel consumption records
- **Status Timeline** — Chronological status changes
- **History** — Trip and allocation history

### Vehicle Compliance

The **Compliance** page shows colour-coded compliance cards:
- **Vehicle Licence** — expiry date with status
- **Roadworthy Certificate** — expiry date
- **Insurance** — validity period
- Licence Plate — registration status

Colours: Green (valid), Amber (expiring within 30 days), Red (expired)

### Vehicle Statuses

| Status | Meaning |
|--------|---------|
| **Available** | Ready for allocation |
| **Allocated** | Assigned to a trip |
| **In Use** | On an active trip |
| **Maintenance** | Undergoing service/repair |
| **Retired** | Permanently removed from service |

### Bulk Import

1. Go to **Fleet → Import Vehicles**
2. Follow the 4-step wizard:
   - Upload a CSV file (download the template first)
   - Map columns to system fields
   - Preview the data with error highlighting
   - Complete the import
3. Rows with errors are shown with descriptions — fix and re-upload

---

## 8. Driver Management

### Adding Drivers

Drivers are created from the Staff module — any employee can be designated as a driver.

### Driver Detail

Each driver page shows:
- Personal details and contact info
- Licence information with expiry date
- Assignment history
- Current allocations

### Licence Expiry

Drivers with expiring licences are shown on:
- The **Expiry Alerts** dashboard
- Driver detail page with colour-coded status
- Daily email alerts (if Inngest is configured)

---

## 9. Expiry Alerts & Compliance

### Expiry Alerts Dashboard

The `/dashboard/expiry-alerts` page shows all items approaching or past expiry:
- Driver licences
- Vehicle licences
- Roadworthy certificates
- Insurance policies

Each item shows:
- Type and entity name
- Expiry date
- Days remaining (or days overdue)
- Status badge (Expiring Soon / Expired / Valid)

### Email Alerts

When Inngest is configured, daily cron jobs send email alerts for:
- Driver licence expiries (daily check)
- Vehicle licence expiries (daily check)
- Maintenance reminders (weekly)

---

## 10. Bulk Imports

### Staff Import

1. Go to **Staff → Import Staff**
2. Download the CSV template from `/staff-import-template.csv`
3. Prepare your data following the template columns
4. Upload and follow the wizard

### Vehicle Import

1. Go to **Fleet → Import Vehicles**
2. Download the template from `/vehicle-import-template.csv`
3. Prepare your data
4. Upload and follow the wizard

### Import History

View past imports at:
- **Staff → Import History** — `/dashboard/staff/imports`
- **Fleet → Import History** — `/dashboard/fleet/imports`

Each batch shows:
- File name and row count
- Success/error counts
- Status (processing, completed, failed)
- Download result option

---

## 11. Settings

### General Settings

Configure your organisation's:
- Name and contact details
- Timezone and locale
- Trip scope defaults (regional/national)
- Fuel card default
- Kilometre thresholds

### Notification Settings

Configure delivery channels:
- In-app notifications (always on)
- Email notifications (opt-in)
- SMS notifications (when configured)

For each notification type:
- Action Required
- Awareness
- Reminder
- Escalation
- Outcome

Set **Quiet Hours** to suppress non-critical notifications.

### Security Settings

- **Change Password** — Update your login password
- **Active Sessions** — View and revoke active sessions
- **Audit Log** — Quick link to audit trail

### Branding

Customise your tenant's appearance:
- Logo URL (light and dark variants)
- Primary colour
- Accent colour
- Document footer text
- Email sender name

---

## 12. Reports & Audit

### Reports Dashboard

The `/dashboard/reports` page offers 6 report types:

| Report | Data Shown |
|--------|------------|
| **Fuel Consumption** | Monthly consumption, top consumers, reimbursement summary, cost analytics |
| **Fleet Utilisation** | Status distribution, vehicle use rates |
| **Trip Summary** | Monthly volume, scope breakdown, distance analytics |
| **Maintenance** | Event log with costs and status |
| **Transport Requests** | Status breakdown, queue overview |
| **Approvals** | Approval times, queue stats |

Each report supports:
- Time range filters (7d, 30d, quarter, year)
- CSV export
- PDF export (all 6 types)
- Print view

### Audit Log

The `/dashboard/audit` page provides an immutable event trail:
- Filter by event type (requests, approvals, allocations, trips, fuel, maintenance, inspections, fleet, staff, auth)
- Free-text search across actions, actors, and entities
- Timeline view with event-type colour coding
- Severity badges (info, warning, critical)
- Hash-chain integrity verification panel

---

## 13. Background Jobs

### Inngest Integration

When configured, Inngest runs scheduled background jobs:

| Function | Schedule | Purpose |
|----------|----------|---------|
| **Step Reminder** | Before step deadline | Reminds users of pending approvals |
| **Step Escalation** | After deadline | Escalates overdue steps to next authority |
| **Approval Completed** | On action | Sends notification on approval/rejection |
| **Vehicle Licence Expiry** | Daily | Checks and alerts on vehicle licence expiry |
| **Driver Licence Expiry** | Daily | Checks and alerts on driver licence expiry |
| **Maintenance Reminder** | Weekly | Reminds of upcoming maintenance |

### Configuration

Set these environment variables:
- `INNGEST_EVENT_KEY` — Event key from Inngest dashboard
- `INNGEST_SIGNING_KEY` — Signing key from Inngest dashboard

The Inngest serve endpoint is at `/api/inngest`.

---

## 14. Security

### Tenant Isolation

All data is strictly isolated by tenant:
- Every database query filters by `tenantId`
- API routes validate tenant membership
- Cross-tenant access is prevented at all levels
- 13 automated tests verify isolation

### Authentication

- Password-based authentication via Better Auth
- Session tokens with configurable expiry
- Server-side session validation on every page
- Middleware protects all dashboard routes

### File Access

- All file uploads are scoped to the user's tenant (`tenant/{tenantId}/...`)
- The `/api/files` endpoint verifies tenant prefix before serving
- Signed URLs with 1-hour expiry for secure access

### Audit Trail

- Every significant action creates an audit event
- Events are linked in a hash chain for integrity verification
- Audit log is append-only — no deletion

---

## 15. Troubleshooting

### Common Issues

**Users can't log in**
- Check user is active (not suspended) in **Administration → Users**
- Verify tenant is active (not suspended) in **Platform → Tenants**
- Reset password from user detail page

**Import fails**
- Check CSV format matches the template
- Ensure required columns are present
- Look for error messages in the import preview step

**Email not sending**
- Verify `RESEND_API_KEY` is set in Vercel environment
- Check `EMAIL_FROM` is configured
- Verify user has email notifications enabled in settings

**Background jobs not running**
- Verify `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are set
- Check Inngest dashboard for function registration
- Verify the `/api/inngest` endpoint is accessible

**Slow page loads**
- Check database connection
- Verify Neon Postgres is not paused (scale-to-zero)
- Check Vercel function logs for errors

### Support Contact

For technical support, contact:
- **Email:** info@flextechmedia.com
- **Contact Form:** https://grn-fleet-system.vercel.app/contact
