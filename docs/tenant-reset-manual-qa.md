# Tenant Reset Manual QA Blueprint

Use this checklist to prove that the governed Tenant Admin reset produces a genuinely clean manual-test state without removing protected access, configuration, recovery evidence, or another tenant's data.

This blueprint is for the in-app governed reset flow under **Tenant Administration → Data Reset**. It complements the development-only CLI reset documentation; it does not replace the approval, recovery-point, confirmation, and audit controls of the governed reset.

## Preconditions

- Use a non-production tenant intended for QA.
- Keep a second tenant with known records as a cross-tenant isolation control.
- Confirm the Tenant Administrator account, system roles, workflow definition, offices/departments, and required fleet/reference configuration exist.
- Record the target tenant's current request/trip/document/notification counts.
- Record at least one known storage-backed file key or downloadable file for each file-bearing area you plan to exercise.
- Do not manually delete records or storage objects between steps; the reset must prove its own cleanup behavior.

## Round 1 — Create intentional operational state

Exercise one realistic request from creation through the configured route.

1. **Requester / Programme Owner**
   - Create a transport request with destinations, dates/times, purpose and passengers.
   - Where applicable attach a request/trip progress file.
   - Submit the request and confirm the requester receives only relevant status notifications.

2. **Supervisor / organisational approvers**
   - Complete every configured approval before Transport Review.
   - Confirm each action is visible in workflow history and audit evidence.

3. **Transport Officer**
   - Correct a schedule/detail field that is permitted during Transport Review.
   - Assign or replace the vehicle and driver with the governed reason/evidence required by the UI.
   - Complete Transport Review with an operational handover/release note.
   - Confirm the corrected request details and assignment are visible downstream.

4. **Administrative Release / Final Authoriser**
   - Complete enabled release and authorisation stages in the configured order.
   - Confirm the request cannot advance if vehicle/driver readiness is invalid.

5. **Driver**
   - Acknowledge the assigned trip through Driver Console.
   - Create at least one operational record such as progress/logsheet/fuel/inspection data.
   - Upload a file-bearing operational record where available.

6. **Documents / notifications**
   - Generate or download an authority/document if the workflow reaches that stage.
   - Confirm role-specific notifications exist for the created workflow.
   - Capture one notification action URL so it can be checked after reset.

Before reset, verify the target tenant now has operational requests/trips/workflow actions, notifications and any intended storage-backed test files.

## Governed reset execution

1. As Tenant Administrator, open the governed Data Reset workspace.
2. Select the intended reset categories. For a full clean operational retest include **Operations**; include Documents/Fleet/People only when their owning rows are intentionally part of the test.
3. Review the dry-run/impact preview carefully.
4. Confirm the preview is tenant-scoped and does not include the isolation-control tenant.
5. Submit the reset request for the required Platform review/approval.
6. Create and verify the required recovery point.
7. Return to the Tenant Administrator execution handoff.
8. Enter the exact confirmation phrase and execute the approved reset.
9. Record the reset request id, removed-row counts, storage objects removed, and storage objects preserved for follow-up.

## Clean-state verification

### Access and configuration must survive

Confirm all protected/bootstrap state selected for preservation still works:

- Tenant Administrator can sign in.
- Required users/memberships and system roles still exist.
- Role assignments/permissions still resolve correctly.
- Tenant branding, offices, departments, regions and workflow definitions remain available unless an explicitly selected reset category says otherwise.
- Protected reset request, approval, recovery-point and audit history remains visible.

### Operational state must be gone

For the target tenant, verify the reset-selected rows no longer appear in any workspace:

- requester request lists and counters
- approvals queues and workflow histories for deleted requests
- trips and allocations
- driver console assignments/logs/progress tied to deleted trips
- inspections, fuel/receipt/OCR and accident/breakdown records selected by the reset
- generated documents/share links selected by the reset
- dashboard activity/count cards derived from deleted records

A page refresh and a fresh login must show the same clean state; the test must not rely on stale client cache.

### Notifications must not become dead operational shells

- Open Notifications as Requester, Transport Officer, Approver and Driver.
- Old operational notifications for removed entities must be absent.
- Their delivery/read/dismissal children must not remain as phantom counts.
- Reset-governance notifications/history that are intentionally protected may remain.
- Revisit the action URL captured before reset. It must not expose deleted data or a still-actionable stale workflow. A clean not-found/closed-state response is acceptable; a broken actionable card is not.

### Storage cleanup

For each storage-backed row that was selected and removed:

- the owning database row is absent;
- the reset outcome reports the object as removed, or explicitly reports it as preserved for follow-up when deletion failed/unconfigured;
- successfully removed objects are no longer downloadable through the application;
- preserved counts are never silently reported as removed.

Files whose owning rows were preserved by the selected categories must remain available.

### Cross-tenant isolation

Repeat spot checks in the second tenant:

- its requests/trips/documents/notifications remain unchanged;
- its users/roles/configuration remain unchanged;
- its storage-backed files remain available.

Any cross-tenant deletion is a release blocker.

## Round 2 — Idempotency and fresh workflow proof

1. Execute the same approved reset category set again from a fresh preview.
2. The second preview/execution should show zero or only legitimate newly-created governance rows; it must not fail because the first reset left orphan dependencies.
3. Confirm there are no stale workflow, notification or document links after the second round.
4. Create a brand-new transport request after the clean reset.
5. Run it through Transport Review and the configured downstream lifecycle again.
6. Confirm sequence numbers, assignments, route resolution, notifications, documents and driver actions work normally after reset.

## Pass criteria

The reset passes manual QA only when all of the following are true:

- target operational state selected by the approved plan is absent;
- protected tenant access/configuration and immutable reset/audit history remain;
- no stale Driver/Requester/Approver/Transport notifications point to deleted operational entities;
- storage removal happens only after successful database deletion and is reported truthfully;
- a second reset is safe/idempotent;
- the isolation-control tenant is untouched;
- a fresh post-reset request can complete the configured workflow normally.

If any storage object is preserved because deletion failed, record its key/count from the reset result and treat that as an explicit follow-up item rather than silently certifying a fully clean storage state.
