# Business Workflow Specification

## 1. Actors

A Requester may also be a licensed driver, but the roles are logically separate. Passengers do not need accounts. The Transport Administrator is the central operational owner for allocations across head office, constituency offices and settlement offices.

## 2. Request lifecycle statuses

Recommended statuses:

```text
DRAFT
SUBMITTED
SUPERVISOR_REVIEW
SUPERVISOR_REJECTED
TRANSPORT_REVIEW
VEHICLE_ALLOCATED
TRIP_AUTHORITY_PREPARED
RELEASE_PENDING
ADMINISTRATIVELY_RELEASED
FINAL_AUTHORISATION_PENDING
AUTHORISED
DRIVER_ACKNOWLEDGEMENT_PENDING
READY_FOR_ISSUE
VEHICLE_ISSUED
IN_PROGRESS
RETURN_DUE
RETURN_INSPECTION
CLOSURE_REVIEW
CLOSED
CANCELLED
```

Do not expose every internal status as a confusing badge. Map them to clear user labels while retaining precise state internally.

## 3. Submission

The requester may save drafts. Submission validates dates, activity, route, passenger/driver requirements and declaration. All senior awareness recipients may be notified, but only the Immediate Supervisor receives an action.

## 4. Supervisor review

Actions:

- Approve with optional comment
- Reject with mandatory reason
- Return for correction with mandatory comment

The requester cannot change an approved revision silently. Every resubmission creates a revision.

## 5. Transport review

The Transport Administrator verifies:

- route and total kilometres;
- trip scope;
- staff/driver details;
- licence validity;
- passenger capacity;
- vehicle-category recommendation;
- special authority;
- attachments and dates.

The exact vehicle is allocated only now.

## 6. Allocation

Allocation locks an eligible vehicle for the period. The transaction checks overlaps and active blockers. The administrator records an override reason when not following the recommendation.

## 7. Trip authority

The Trip Authority is prefilled from the request, employee, driver and vehicle records. The Transport Administrator completes only fields that cannot be derived.

It includes driver ID/licence, purpose, destinations, period, vehicle details, authorised kilometres, additional drivers/passengers and special weekend/after-hours authority.

## 8. Regional release and authorisation

1. Control Administrative Officer conducts departure inspection and administrative release.
2. Deputy Director authorises.
3. Driver acknowledges.
4. Physical issue records keys, fuel card and vehicle.

Administrative release alone cannot create an issue record.

## 9. National release and authorisation

1. Director conducts/approves administrative release.
2. CRO authorises.
3. Driver acknowledges.
4. Physical issue occurs.

A tenant may delegate operational inspection capture to a Control Administrative Officer while the Director remains the legal release actor; the document must show both roles if configured.

## 10. During trip

The driver adds daily logs and fuel records. Missing daily logs produce reminders. Odometer values must be monotonic unless an authorised correction explains the issue.

## 11. Return and closure

1. Driver marks return ready.
2. Control Administrative Officer records return inspection.
3. System calculates distance/fuel/variance and highlights missing items.
4. Transport Administrator requests correction or closes.
5. Closing returns vehicle to available unless a defect blocks it.

## 12. Rejection, revision and cancellation

- Draft: freely editable.
- Submitted but not supervisor-approved: requester may withdraw.
- Rejected: requester creates corrected revision.
- After allocation: material change requires Transport Administrator review.
- After final authorisation: dates, destination, scope, vehicle, driver or passenger-capacity changes repeat applicable stages.
- Cancellation before issue releases booking.
- Cancellation after issue requires return inspection and closure.

## 13. Emergency override

The designated officer selects stages to override, records a reason, evidence and expiry, and confirms post-trip review. The system shows an emergency banner on all related records and documents. Overridden steps remain visible as “bypassed by authorised override,” not “approved.”

## 14. Working-hours escalation

A tenant calendar defines business days, holidays and quiet hours. Reminder/escalation timers count working time. Emergencies bypass quiet hours.
