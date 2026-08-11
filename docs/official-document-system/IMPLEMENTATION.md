# Official Document System — Implementation

## Architecture

The system uses one React-PDF primitive layer and typed document view models. Server routes generate the authoritative byte stream; preview, download, and print are different browser actions over that same artifact.

## Work packages

1. Harden shared page, header, table, safe-text, verification, certification, and theme primitives.
2. Rebuild Trip Authority against the approved A–H form.
3. Complete Transport Request and normalized goods/equipment persistence.
4. Standardize the remaining typed operational documents and add missing operational types.
5. Preserve canonical, tenant-isolated Preview/Download/Print behavior.
6. Refine Top Fuel Consumers rank treatment without changing report data logic.
7. Generate and rasterize representative and stress PDFs, then run focused, type, lint, build, browser, theme, responsive, and accessibility checks.

## Compatibility policy

- Existing generated snapshots remain renderable.
- New optional fields default to safe display values.
- New document types use the same `generated_documents` lifecycle and PDF endpoint.
- Typed renderers accept legacy snapshot shapes through explicit adapters.

## Deployment policy

Deploy once, only after the entire implementation and validation set passes locally.

## Validation artifacts

- `artifacts/trip-authority-reference.pdf` and `.png`
- `artifacts/trip-authority-stress.pdf` (three pages)
- `artifacts/transport-request-reference.pdf`
- `artifacts/fuel-report-stress.pdf` and page-one `.png`
- `artifacts/trip-summary-reference.pdf` and `.png`
- `artifacts/inspection-reference.pdf` and `.png`
- `artifacts/fuel-receipt-reference.pdf` and `.png`
- `artifacts/driver-logsheet-reference.pdf` and `.png`
- `artifacts/incident-record-reference.pdf` and `.png`
- `browser-qa/report.md` and its desktop/mobile light/dark screenshots
