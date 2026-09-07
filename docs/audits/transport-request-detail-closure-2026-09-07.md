# Transport Request Detail Closure — 2026-09-07

Authoritative base: `f4c8d66af65a4b6bd281f3aabdd9413edc63407b`.

## Finding

The internal Transport Request detail page still reflected the older request model. New governed facts captured by the request flow were persisted in the schema but were not all visible on detail: request origin, trip/budget classification, estimated cost/funding metadata, driver preference, richer passenger context, and goods/equipment child rows.

## Closure

- The detail loader now selects the governed trip/budget fields from `transport_requests`.
- Goods/equipment are loaded from `request_goods_equipment` and rendered as a dedicated child-record table.
- External passenger organisation/contact/ID context, traveller role, and reason for travel are loaded and displayed.
- Existing tenant-scoped request lookup, record-scope enforcement, cancellation/resubmission actions, routes, activities, drivers, attachments, and programme linkage are preserved.
- Source-contract coverage pins the governed fields, goods/equipment child loading/rendering, passenger context, and tenant scope.

## Validation gate

Exact-head typecheck, full tests, production build, integration/Chromium closure, and current-head Codex review are required before merge.
