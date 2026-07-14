# Documents and PDF Specification

## Document types

1. Programme of Activities
2. Transport Request
3. Vehicle Allocation/Requisition
4. Approval History
5. Trip Authority and Logsheet Statement
6. Vehicle Release Record
7. Departure Inspection
8. Daily Logsheet
9. Fuel Summary
10. Return Inspection
11. Trip Completion Report
12. Vehicle History Report
13. Audit Report

## Design

Use tenant crest/logo and official contact details. Documents should feel modern and official, not copy the paper forms. Use Onest, compact sections, strong labels, subtle brand blue rules and clear signatures.

## Snapshot and versioning

A generated document stores:

- document type and version;
- template version;
- immutable source snapshot;
- generation actor/time/reason;
- file hash and storage key;
- draft/issued/superseded state;
- redaction profile.

Regeneration creates a new version. Issued documents are not overwritten.

## Signature representation

Approval evidence may display a saved signature image or a styled typed representation plus authenticated action details. Add a statement that it represents an authenticated system action and is not a third-party certified electronic signature.

## Verification

Include a unique reference and QR code leading to a minimal verification page showing document type, tenant, status, issue date and whether it is current/superseded. Do not reveal sensitive driver data.

## Layout rules

- A4 portrait by default; landscape for wide vehicle-history/log tables only when necessary.
- 14–16mm margins.
- Header and footer repeated on multi-page documents.
- Page numbers.
- Draft watermark.
- Long text wraps; no clipping.
- Daily logs repeat table headers.
- Photos use caption and stage.
- Redacted fields show “Redacted” rather than blank ambiguity.

## Preview

Dashboard preview must show the complete rendered document before download/share. Use a lazy-loaded PDF viewer and fall back to server-generated preview images if browser rendering fails.

## External sharing

External version uses a redaction profile. Default hides full ID/licence, personal contacts, fuel-card data, internal comments, original private files and detailed audit metadata.
