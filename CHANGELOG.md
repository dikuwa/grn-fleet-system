# Changelog

## 2026-07-14 — Phase 9: Fuel management and Phase 10: Approval workflow

### Added

**Phase 9 — Fuel Management**

**Fuel Records List**
- DB-backed server component with search (GRN, station, reference), payment method and anomaly state filters, pagination
- Summary cards (transactions, total volume, total cost, flagged count)
- Payment method badges (Fuel Card, Cash, Personal Reimbursement)
- Anomaly state indicator (flagged entries highlighted with error styling)
- Proper error boundary: `isDbConnected()` check + try/catch fallback

**Fuel Transaction Detail**
- Full transaction summary with vehicle info, payment method, anomaly badge, verification status
- Transaction details panel (fuel type, litres, amount, unit price calculation, fill type, odometer)
- Anomaly status panel with notes display and verification indicator
- Reimbursement card (amount, state, paid date, notes) when linked to a personal expense claim
- Receipts section with file names and verification badges

**New Fuel Entry Form**
- Client component with vehicle, trip, station, fuel type, litres, amount, odometer, payment method, fill type inputs
- Payment method and fill type selectors
- Receipt reference and notes fields

**Reimbursements List**
- DB-backed server component with state filters (pending/approved/paid/rejected), pagination
- Summary cards (total claims, pending count, total amount)
- Claimant name, vehicle GRN, date display

**Phase 10 — Approval Workflow**

**Approvals List**
- DB-backed server component with status filters, pagination
- Summary cards (total workflows, active/awaiting action, completed counts)
- Workflow instance rows with request reference, status badge, scope badge, step info, requester name
- Proper error boundary: `isDbConnected()` check + try/catch fallback

**Approval Detail**
- Full workflow summary card with status badge, scope badge, step progression
- Workflow timeline showing all steps with completion status
- Each step shows: icon (checkmark/arrow/pending dot), label, description, action result badge
- Action history table with all recorded decisions
- Emergency override banner when applicable
- "Take Action" button when workflow is active

**Approval Action Form**
- Client component with 3 action options: Approve (success style), Return for Changes (pending style), Reject (error style)
- Comment textarea for recording decision notes
- Loading spinner during submission processing

### Fixed
- Unused imports cleaned across all Phase 9–10 files (reimbursements, trips, employees, CreditCard, AlertTriangle, workflowActions, StatusBadge)
- Unescaped entities in JSX fixed (`react/no-unescaped-entities`)

### Known Gaps (Phase 9–10)
- All form submissions are stubbed — need real DB insert
- Fuel receipt image upload not implemented
- Workflow engine not wired to actually advance request statuses
- No tenant isolation on queries (requires auth session)
- No email/in-app notification on workflow actions

### Commands verified

- `pnpm typecheck` — passes (0 errors)
- `pnpm lint` — passes (0 errors, 0 warnings)
- `pnpm build` — passes
