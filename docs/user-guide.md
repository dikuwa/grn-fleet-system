# GovFleet Namibia — User Guide

> **Version:** 1.0  
> **Last Updated:** 2026-07-20  
> **App URL:** https://grn-fleet-system.vercel.app

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
3. [Transport Requests](#3-transport-requests)
4. [Approvals](#4-approvals)
5. [Trips](#5-trips)
6. [Fuel & Reimbursements](#6-fuel--reimbursements)
7. [Inspections](#7-inspections)
8. [Notifications](#8-notifications)
9. [Driver Mobile View](#9-driver-mobile-view)
10. [Frequently Asked Questions](#10-frequently-asked-questions)

---

## 1. Introduction

GovFleet Namibia is the Ministry of Works & Transport's government fleet management system. It manages the full lifecycle of government transport — from trip requests through approvals, vehicle allocation, inspections, fuel tracking, and trip closure.

### Key Concepts

- **Tenant**: Your organisation (e.g. Kavango East Regional Council). Each tenant has its own vehicles, staff, and data.
- **Transport Request**: A formal request for government vehicle use, submitted by staff.
- **Workflow**: The approval chain that a request passes through (supervisor → transport → release → authorise → driver acknowledge).
- **Allocation**: Assigning a specific vehicle and driver to an approved request.
- **Inspection**: Pre-departure (before trip) and return (after trip) vehicle checks.

---

## 2. Getting Started

### Logging In

1. Navigate to https://grn-fleet-system.vercel.app
2. Click **Login** in the top-right corner
3. Enter your email and password provided by your system administrator
4. Click **Sign In**

> **First time?** Your administrator will provide your initial credentials. You'll be able to change your password after logging in.

### Navigation

The dashboard sidebar provides access to all modules:

| Section | Pages |
|---------|-------|
| **Overview** | Dashboard, Notifications, Active Trips |
| **Transport** | Requests, Approvals, Allocations, Trips |
| **Fleet** | Fleet List, Vehicle Compliance, Defects, Maintenance, Fuel, Imports |
| **People** | Drivers, Staff |
| **Documents** | All Generated Documents |
| **Reports** | KPI Reports, Audit Log |
| **Administration** | Users, Roles, Offices, Departments, Regions, Settings |

### Dark Mode

Click the **Sun/Moon icon** in the top-right corner (or on any public page) to toggle between light and dark mode. Your preference is saved automatically.

---

## 3. Transport Requests

### Creating a Request

1. Click **Requests** in the sidebar, then **New Request**
2. Fill in the 5-step wizard:

   | Step | Fields |
   |------|--------|
   | **Trip Details** | Purpose, department, scope (regional/national), programme activity |
   | **Schedule** | Start/end dates, estimated kilometres |
   | **Passengers** | Add passengers (name, title, department) |
   | **Drivers** | Preferred driver (optional) |
   | **Review** | Review all details and submit |

3. Click **Submit Request**

### Request Statuses

| Status | Meaning |
|--------|---------|
| **Draft** | Not yet submitted |
| **Pending Approval** | Submitted, awaiting workflow decisions |
| **Approved** | All approvals granted |
| **Rejected** | Rejected during workflow |
| **Cancelled** | Cancelled by requester or admin |

### Viewing Requests

- The **Requests list** shows all requests with status, reference number, and dates
- Click any request to see full details including activities, passengers, and workflow timeline

---

## 4. Approvals

### The Approval Workflow

Transport requests go through a defined approval chain:

1. **Supervisor Approval** — Your supervisor reviews and approves/rejects
2. **Transport Officer Review** — Transport department checks feasibility
3. **Vehicle Release** — Vehicle is released for the trip
4. **Trip Authorisation** — Final authorisation
5. **Driver Acknowledgement** — Assigned driver acknowledges

Each step may require a comment explaining the decision.

### Taking Action

1. Go to **Approvals** in the sidebar
2. Find a request awaiting your action
3. Click **View Details**
4. Choose **Approve**, **Reject**, or **Return for Changes**
5. Add a comment explaining your decision (required for reject/return)

### Emergency Override

In urgent situations, an authorised user can perform an emergency override to skip remaining approval steps. This is audited and logged.

---

## 5. Trips

### Viewing Active Trips

The **Active Trips** page shows all trips currently on the road with:
- Real-time duration (updating every second)
- Status (In Progress, Return Due, Return Inspection, Closure Review)
- Vehicle and driver information
- Quick links to trip detail

### Trip Lifecycle

```
Allocation → Trip Created → Departure Inspection → In Progress
→ Return Inspection → Closure Review → Closed
```

### Trip Detail

Click any trip to view:
- Vehicle and driver info
- Trip timeline
- Inspection records
- Fuel transactions
- Closure details

### Closing a Trip

After return inspection is completed, the trip enters **Closure Review**. An administrator reviews and closes the trip, recording:
- Actual kilometres travelled
- Total fuel used
- Total fuel cost
- Notes

---

## 6. Fuel & Reimbursements

### Recording Fuel

1. Go to **Fuel** in the sidebar
2. Click **Add Fuel Entry**
3. Enter: vehicle, date, litres, cost per litre, total cost, payment method
4. Submit

### Reimbursements

If fuel was paid with personal funds:
1. Create a fuel entry with payment method "Personal"
2. A reimbursement claim is automatically created
3. Administrators can process reimbursements from the **Reimbursements** page

### Offline Support

If you lose connectivity while entering fuel:
- Tap **Save Draft** to save locally
- The draft will auto-sync when connectivity is restored
- A badge in the bottom-left shows your pending draft count

---

## 7. Inspections

### Departure Inspection (Pre-Trip)

Before any trip, complete a departure inspection:

1. From the trip detail page, click **Complete Departure Inspection**
2. Enter odometer reading and fuel level
3. Go through the checklist across 6 categories:
   - Exterior (body, windscreen, windows, mirrors)
   - Tyres & Wheels (pressure, tread, damage)
   - Lights & Indicators (headlights, tail lights, brake lights, indicators)
   - Interior (seat belts, seats, dashboard, horn, wipers)
   - Documents (licence disc, roadworthy, insurance)
   - Safety Equipment (fire extinguisher, first aid kit, warning triangle)
4. Mark each item as **Pass**, **Fail**, or **N/A**
5. Take photos if needed
6. Submit — if all critical items pass, the trip begins

### Return Inspection (Post-Trip)

After returning from a trip:

1. Click **Complete Return Inspection**
2. Enter odometer reading and fuel level
3. Check for new damage, missing equipment, and completed paperwork
4. Document any defects found
5. Submit — if all items pass, the trip moves to closure review

### Defects

Failed inspection items automatically create vehicle defects:
- **Critical defects** block departure until resolved
- Defects can be resolved from the **Defects** page

---

## 8. Notifications

The notification bell in the top bar shows your unread count.

### Notification Types

| Type | Description |
|------|-------------|
| **Action Required** | An approval or action is waiting for you |
| **Awareness** | Information you should know |
| **Reminder** | Something needs your attention soon |
| **Escalation** | A request has been escalated to you |
| **Outcome** | Result of a request or action |

### Managing Notifications

- Click the bell to view your notification list
- Filter by type (Action Required, Awareness, etc.)
- Toggle between Read/Unread/All
- Click **Mark All Read** to clear all notifications
- Click a notification to navigate to the related page

---

## 9. Driver Mobile View

### Driver Self-Service Portal

Drivers can access a mobile-optimised view at **Driver Self-Service** in the sidebar:

- View assigned trips and allocations
- Check vehicle details
- View upcoming schedules

### Driver Mobile

The **Driver Mobile** page provides a simplified mobile interface with:
- Large touch targets
- Trip overview
- Quick access to inspections
- Fuel entry

> **Tip:** Add the app to your home screen for a native-like experience. The app works offline for core functions.

---

## 10. Frequently Asked Questions

**Q: I can't log in — what should I do?**  
A: Contact your system administrator. They can reset your password or check your account status.

**Q: How do I change my password?**  
A: Go to **Settings → Security** and use the password change form.

**Q: Why can't I approve a request?**  
A: You may not have the required permission. Check with your administrator. Also verify that it's your turn in the workflow — the system will show you only actions you're authorised to take.

**Q: Can I save a request and finish later?**  
A: Yes! The request wizard saves your progress as you go. You can close the page and return later.

**Q: The app works offline?**  
A: Yes. Core functions like fuel entry, inspection forms, and transport request creation support offline drafts. They'll sync automatically when you're back online.

**Q: How do I enable dark mode?**  
A: Click the Sun/Moon icon in the top-right corner of any page. Your preference is saved automatically.

**Q: Who do I contact for help?**  
A: Your organisation's system administrator, or use the Contact page at /contact.
