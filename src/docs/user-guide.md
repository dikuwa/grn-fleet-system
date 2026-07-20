# GovFleet Namibia — User Guide

> **Version:** 1.0.0  
> **Last Updated:** 2026-07-20  
> **Application:** https://grn-fleet-system.vercel.app  

---

## 1. Getting Started

### 1.1 Logging In

1. Navigate to https://grn-fleet-system.vercel.app
2. Click the **Sign In** button
3. Enter your email and password
4. You will be redirected to your organisation's dashboard

> **First time?** Contact your Transport Administrator to create your account.

### 1.2 Dashboard Overview

The dashboard provides a high-level summary of your organisation's fleet operations:

- **Active Trips** — Currently ongoing trips with duration tracking
- **Pending Requests** — Transport requests awaiting approval
- **Vehicles Available** — Ready-to-use vehicles in your fleet
- **Critical Alerts** — Overdue inspections, expiring documents, urgent defects

---

## 2. Transport Requests

### 2.1 Creating a Request

1. Navigate to **Transport Requests** in the sidebar
2. Click **New Request**
3. Complete the 5-step wizard:
   - **Step 1:** Trip details (date, purpose, type)
   - **Step 2:** Passenger information
   - **Step 3:** Route details (origin, destination)
   - **Step 4:** Document uploads (optional)
   - **Step 5:** Review and submit
4. Click **Submit Request**

### 2.2 Viewing Request Status

Requests progress through these stages:
- **Draft** — Not yet submitted
- **Pending** — Awaiting approval
- **Approved** — Approved for allocation
- **Rejected** — Declined with reason
- **Returned** — Sent back for revision

---

## 3. Approvals

### 3.1 Approving or Rejecting Requests

1. Navigate to **Approvals** in the sidebar
2. Click on the request to review details
3. Choose an action:
   - **Approve** — Accept the request
   - **Return** — Send back with revision notes
   - **Reject** — Decline with reason
4. Add a comment explaining your decision

### 3.2 Emergency Override

For urgent government operations, authorised users can:
1. Open the request detail page
2. Click **Emergency Override**
3. Provide the override reason
4. Submit — bypasses normal approval chain

---

## 4. Vehicle Allocations

### 4.1 Allocating a Vehicle

1. Navigate to **Allocations** in the sidebar
2. Click **New Allocation**
3. Select an approved transport request
4. Review vehicle recommendations with scores
5. Select a vehicle and confirm

### 4.2 Assigning a Driver

1. Open the allocation detail page
2. Under **Driver Assignment**, click **Assign Driver**
3. Search and select a driver
4. Verify licence validity (system checks expiry)
5. Confirm assignment

---

## 5. Inspections

### 5.1 Departure Inspection

Before any trip, complete a departure inspection:

1. Navigate to **Inspections** in the sidebar
2. Click **Departure Inspection**
3. Select the vehicle and trip
4. Complete all checklist items across categories:
   - Exterior
   - Tyres & Wheels
   - Lights & Indicators
   - Interior
   - Documents
   - Safety Equipment
5. Take photos of any defects (optional)
6. Submit — critical failures block departure

### 5.2 Return Inspection

After trip completion:

1. Navigate to **Inspections** in the sidebar
2. Click **Return Inspection**
3. Complete the return checklist
4. Report any new defects found
5. Take photos for evidence (optional)
6. Submit — all-pass auto-closes the trip

### 5.3 Template Management

Administrators can create custom inspection templates:

1. Navigate to **Insp. Templates** in the sidebar
2. Click **Create Template**
3. Add checklist items with categories and critical flags
4. Activate the template for use in inspections

---

## 6. Trips

### 6.1 Active Trips

View all ongoing trips:

1. Navigate to **Active Trips** in the sidebar
2. See real-time duration tracking
3. Status breakdown: In Progress, Return Due, Return Inspection, Closure Review

### 6.2 Trip Lifecycle

| Status | Description |
|--------|-------------|
| Pending | Trip created, awaiting departure inspection |
| In Progress | Vehicle on the road |
| Return Due | Expected return date passed |
| Return Inspection | Vehicle returned, awaiting inspection |
| Closure Review | Post-trip review by Transport Administrator |
| Closed | Trip completed and closed |

---

## 7. Fleet Management

### 7.1 Viewing the Fleet

Navigate to **Fleet** in the sidebar to see:
- Vehicle list with search and filters
- Colour-coded compliance status
- Licence expiry dates
- Open defects

### 7.2 Vehicle Detail

Click any vehicle to see:
- **Overview** — Key details and status
- **Maintenance** — Service history
- **Defects** — Open and resolved issues
- **Fuel** — Fuel transaction history
- **Compliance** — Document expiry timeline
- **Status Timeline** — Chronological status changes

### 7.3 Importing Vehicles

1. Navigate to **Fleet > Import Vehicles**
2. Download the CSV template
3. Fill in vehicle data
4. Upload, map columns, preview, and complete

---

## 8. Fuel Management

### 8.1 Recording Fuel

1. Navigate to **Fuel** in the sidebar
2. Click **New Entry**
3. Fill in:
   - Vehicle and trip
   - Station name and fuel type
   - Litres and amount
   - Odometer reading
   - Payment method (fuel card, cash, or personal reimbursement)
4. Submit

### 8.2 Reimbursements

Personal fuel expenditures can be claimed:
1. Navigate to **Reimbursements**
2. View pending, approved, and paid claims
3. Administrators can approve/reject/pay

---

## 9. Staff Management

### 9.1 Staff Directory

1. Navigate to **Staff** in the sidebar
2. Search by name, department, or office
3. Click an employee to view details

### 9.2 Importing Staff

1. Navigate to **Staff > Import**
2. Download the CSV template
3. Upload, map columns, preview, and complete

---

## 10. Reports

Access reports from the sidebar:

- **Fuel Reports** — Consumption analysis
- **Fleet Reports** — Utilisation metrics
- **Trips Reports** — Trip statistics
- **Maintenance Reports** — Service costs and frequency
- **Requests Reports** — Approval turnaround
- **Approval Analytics** — Approval metrics

Export options: CSV, Excel

---

## 11. Notifications

### 11.1 In-App Notifications

- Unread count displayed in the top bar (updates every 30 seconds)
- Click to view full list with type filters
- Action links for quick navigation

### 11.2 Email Notifications

Configured notifications include:
- Request approved/rejected
- Vehicle released
- Trip authorised
- Licence expiry alerts
- Maintenance reminders

---

## 12. Offline Mode

The application supports offline operation:

1. Forms (fuel, inspections) can be saved as local drafts
2. Drafts sync automatically when connectivity resumes
3. View sync status at **Sync Conflicts** in the sidebar
4. Resolve any sync conflicts manually if needed

---

## 13. Getting Help

- **Contact:** info@flextechmedia.com
- **Privacy Policy:** https://grn-fleet-system.vercel.app/privacy
- **Technical Support:** Contact your system administrator
