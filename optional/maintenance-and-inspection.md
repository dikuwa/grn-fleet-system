# Maintenance and Inspection Specification

## Vehicle availability blockers

A vehicle is ineligible when:

- allocated/issued on an overlapping trip;
- out of service or written off;
- has a critical unresolved defect;
- roadworthy/licence conditions block use;
- scheduled maintenance blocks the period;
- required departure inspection cannot pass.

## Defects

Fields: vehicle, trip/inspection source, severity, description, photos, reported by/time, blocking flag, resolution and close evidence.

Severity:

- Informational
- Minor (usable with monitoring)
- Major (restricted)
- Critical (immediate out of service)

## Service reminders

Support due date and due odometer. Status is due soon, due, overdue or completed. Completing a maintenance event updates next due values and odometer history.

## Inspections

Checklist templates are versioned per tenant. A trip inspection stores the template version so later changes do not alter historical evidence.

Required photo rules may be item-specific, such as front, rear, both sides, odometer and dashboard warning lights.

## Return outcome

A return inspection may:

- return vehicle to available;
- return vehicle with minor defect;
- place vehicle out of service;
- create maintenance follow-up;
- require driver explanation.

The Transport Administrator confirms final status during closure.
