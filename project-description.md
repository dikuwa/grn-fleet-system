# Project Description

## 1. Product summary

**GovFleet Namibia** is a multi-tenant government fleet-management platform that replaces paper-based transport requests, approvals, vehicle allocation, trip authorities, inspections, logs, fuel records and trip closure with one traceable digital workflow.

The Kavango East Regional Council is the pilot tenant. The platform must be able to onboard all 14 Namibian regional councils and, later, ministries, offices and agencies without rewriting the core application.

The public website markets the pilot as a proposed fleet-management solution. It must not imply official national adoption until formal approval exists.

## 2. Classification

- **Project state:** New greenfield project
- **Type:** Public marketing website plus secure internal operational application
- **Business model:** Multi-tenant public-sector SaaS/pilot platform
- **Primary users:** Government employees, transport administrators, approving officers and drivers
- **Expected pilot scale:** Approximately 100 staff, tens of vehicles and low-to-moderate daily transaction volume
- **Growth target:** 14 regional councils and later central government bodies
- **Realtime need:** Near-realtime workflow notifications; no live vehicle tracking in v1
- **Offline need:** Driver draft capture for logsheet entries and inspection preparation
- **Compliance posture:** Strong privacy, least privilege, permanent audit history and controlled document sharing
- **Budget posture:** Practical cloud prototype with a documented path to government/on-premise hosting

## 3. Value proposition

The current process may take 8–12 hours and relies on repeated manual transcription. The target is a clear, guided workflow that can normally complete approvals and vehicle preparation within approximately 30 minutes when responsible officers act promptly.

The product reduces duplicated data entry, makes responsibility visible, prevents unavailable vehicles from being allocated, improves vehicle condition tracking, and creates a complete evidence trail.

## 4. Success criteria

- A request is submitted once and reused across all downstream forms.
- Approvers see only actions relevant to their role.
- The system prevents self-approval and incompatible approval combinations.
- Vehicle availability reflects allocations, active trips, defects and maintenance.
- Documents are generated from verified records, not retyped manually.
- Drivers can complete daily logs on a phone, including offline drafts.
- Managers can measure approval delays, utilisation, kilometres, fuel and fleet condition.
- A second tenant can be onboarded without code changes.
- No tenant can access another tenant’s data.

## 5. Users and roles

### Platform roles

- **Platform Super Administrator:** Creates and suspends tenants, manages platform configuration, sees platform health, and cannot approve tenant trips unless explicitly assigned as tenant staff.
- **Platform Support Administrator:** Optional restricted support role with audited impersonation disabled by default.
- **Platform Auditor:** Optional read-only oversight across permitted tenants.

### Tenant roles

- **Transport Administrator:** Main tenant fleet administrator; manages staff access, vehicles, allocation, trip-authority preparation, maintenance status and trip closure.
- **Requester / Programme Owner:** Creates and signs a transport request.
- **Immediate Supervisor:** Reviews, comments, approves or rejects the requester’s programme activity.
- **Control Administrative Officer:** Performs regional administrative vehicle release and departure/return inspections.
- **Deputy Director:** Gives final regional trip authorisation.
- **Director:** Performs national/inter-regional administrative release.
- **Chief Regional Officer:** Gives final national/inter-regional authorisation.
- **Assigned Driver:** Acknowledges assignment, co-signs inspections, records logsheet and fuel entries, and submits the trip for return.
- **Additional Driver:** Optional authorised driver on the same trip.
- **Employee / Passenger:** Directory-only staff member who may travel without system login.
- **Tenant Auditor:** Read-only access to reports, documents and audit history.

Users may hold multiple permanent or time-limited acting roles. A role assignment records effective dates and whether actions were taken in an acting capacity.

## 6. Core workflows

### Regional trip

1. Requester completes programme activity and transport request.
2. Requester signs and submits.
3. Immediate Supervisor comments and approves.
4. Transport Administrator validates route, driver requirements and passenger needs.
5. System recommends a vehicle category.
6. Transport Administrator allocates the exact vehicle and prepares the Trip Authority.
7. Control Administrative Officer performs administrative release and departure inspection.
8. Deputy Director gives final authorisation.
9. Assigned Driver acknowledges and signs.
10. Vehicle, keys and fuel card are physically issued.
11. Driver records daily logs and fuel entries.
12. Control Administrative Officer performs return inspection.
13. Transport Administrator verifies and closes the trip.

### National/inter-regional trip

The same process applies, except:

- Director performs administrative release.
- Chief Regional Officer gives final authorisation.

### Emergency workflow

A designated senior officer may use a tenant-enabled emergency override. The override must identify the reason, supporting evidence, stages bypassed and required post-trip review. It does not erase skipped steps from history.

## 7. Request data

A request captures:

- programme/activity title and description;
- requester/programme owner;
- department and office;
- origin, destination and venue;
- trip scope: regional or national/inter-regional;
- mapped route distance;
- manual additional kilometres and reason;
- total authorised kilometres;
- start and completion dates/times;
- passenger count and selected staff passengers;
- nominated driver and optional additional drivers;
- terrain, road condition, luggage/equipment and accessibility needs;
- weekend/after-hours special authorisation requirement;
- supporting attachments;
- requester signature, date and declaration.

## 8. Vehicle recommendation and allocation

The requester describes the transport need rather than reserving a specific vehicle. The system uses deterministic rules based on passenger count, route scope, road/terrain, duration, luggage and vehicle availability. A language model may provide a human-readable explanation but cannot authorise a vehicle or provide the official route distance.

Examples:

- sedan for fuel-efficient tarred-road travel;
- bakkie for gravel, difficult terrain or field activities;
- higher-capacity vehicle for larger passenger groups or equipment.

The Transport Administrator makes the final allocation and may override the recommendation with a recorded reason.

## 9. Reservation rules

- No vehicle is reserved before supervisor approval.
- Exact allocation creates a provisional booking.
- Overlapping allocations are blocked.
- Defects, maintenance, licence expiry, roadworthy expiry or out-of-service status may block availability.
- The vehicle remains unavailable until the active trip is closed.
- A pre-authorisation vehicle change is audited.
- A post-authorisation vehicle change repeats release and final authorisation.

## 10. Inspections

Departure and return inspections capture:

- odometer and fuel level;
- exterior/interior condition;
- existing and new damage;
- tyres, spare wheel, tools and safety equipment;
- windscreen, windows, mirrors, lights, indicators and brakes;
- dashboard warning lights;
- vehicle and fuel-card documents;
- required photographs;
- inspector and driver acknowledgement.

Physical issue is blocked until final authorisation and departure inspection are complete.

## 11. Digital logsheet

Each daily entry records driver, date, odometer out/in, departure and arrival times, origin, destination, distance, remarks and signature acknowledgement. The interface is a mobile list/form, not a wide paper table. Offline entries are drafts until synchronised and submitted.

## 12. Fuel and reimbursement

Supported payment methods:

- government fuel card;
- cash;
- personal payment requiring reimbursement.

The system records station, date/time, fuel type, litres, amount, odometer, transaction reference, receipt, fill type and verification status. It flags duplicates, invalid odometer sequence, incorrect fuel type, missing receipt, unusual quantity and out-of-period transactions.

## 13. Staff directory and access

The employee directory is separate from login accounts. CSV and Excel imports use mapping, preview, validation, duplicate detection, correction and import history. Importing staff never activates accounts automatically.

Driver assignment requires a valid licence and authorisation. Expired credentials block assignment, with an audited Transport Administrator override.

## 14. Fleet and maintenance

Version 1 includes vehicle records, condition, photos/documents, service reminders, defects, maintenance history, downtime, inspection history, out-of-service and write-off status. Supplier procurement, work orders and parts inventory are deferred.

## 15. Notifications

- In-app notifications are immediate.
- Email is used for approvals, rejection, allocation, reminders, escalation and closure.
- WhatsApp is manual: open/share a secure link or use native sharing.
- SMS remains a disabled future adapter.
- Default reminder: two working hours.
- Default escalation: four working hours.
- Quiet hours are tenant-configurable; emergencies bypass them.

All senior stakeholders may receive awareness notifications when a request is submitted, but only the current actor sees an approval control.

## 16. Documents

Generated PDFs include Programme of Activities, Transport Request, Vehicle Allocation, Approval History, Trip Authority, Vehicle Release, Departure Inspection, Daily Logsheet, Fuel Summary, Return Inspection, Trip Completion, Vehicle History and Audit Report.

Documents include tenant branding, reference number, status, approval evidence, generation timestamp, page numbers, verification reference and draft watermark where applicable.

## 17. Sharing

- Authenticated internal viewing
- Secure external link with expiry and revocation
- Redacted external document profile
- Copy link
- Native share
- Open in WhatsApp
- Email
- PDF download and print

## 18. Reports

- requests by status, date, department and office;
- approval turnaround by stage;
- fleet availability and utilisation;
- kilometres by vehicle, driver, office and programme;
- authorised versus actual kilometres;
- fuel litres, cost, consumption and reimbursements;
- missing receipts;
- licence and document expiry;
- defects, downtime and maintenance history;
- late return and overdue closure;
- emergency overrides;
- rejection, cancellation and revisions;
- full audit history.

Exports: CSV, Excel, PDF and print.

## 19. Public website pages

- Home
- How It Works
- Platform Features
- Security and Accountability
- Multi-tenant Government Readiness
- Pilot / Kavango East story
- Request a Demonstration / Contact
- Privacy and data handling
- Login

## 20. Secure application pages

- Dashboard
- My Requests
- Create Request wizard
- Request detail and timeline
- Approvals Inbox
- Allocations
- Trips
- Driver mobile view
- Daily Logs
- Fuel Records
- Fleet
- Vehicle detail
- Inspections
- Defects and Maintenance
- Staff Directory
- Users and Roles
- Offices and Departments
- Documents
- Notifications
- Reports
- Audit Log
- Tenant Settings
- Platform Tenants (platform role only)

## 21. Required UI states

Every screen must cover loading, empty, no-results, validation error, network error, permission denied, offline, pending synchronisation, success and destructive confirmation states.

## 22. Out of scope for v1

- live GPS/telematics;
- automated WhatsApp API;
- active SMS;
- fuel-card provider integration;
- full procurement and supplier workflow;
- maintenance work orders and parts inventory;
- public staff registration;
- fully offline approvals;
- online payments;
- international travel workflow;
- certified third-party electronic signatures;
- direct HR/payroll integration.

## 23. Acceptance criteria

A release is acceptable only when the regional and national workflows, inspection/issue safeguards, driver logs, fuel records, closure, document generation, sharing, imports, tenant isolation, permissions, reports and audit history are proven by automated tests and a successful production build.
