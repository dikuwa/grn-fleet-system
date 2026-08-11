# Official Document System — Research

## Requirements source

The implementation follows the 87-phase replacement master prompt supplied for the GRN Fleet official document system and the three approved visual references: the Official Vehicle Trip Authority, the system-document family, and Reports & Analytics.

## Repository baseline

- Baseline branch: `master`
- Baseline commit: `1d3e238 feat: harden roles subscriptions and routing (#26)`
- Baseline state: clean and synchronized with `origin/master`
- Runtime: Next.js with server-side `@react-pdf/renderer` generation

## Existing document inventory

| Document | Renderer/source | Current path | Final migration status |
| --- | --- | --- | --- |
| Official Vehicle Trip Authority | `src/lib/pdf/trip-authority.tsx` | allocation/trip authority PDF route and generated-document route | Migrated to exact A–H fixed-red template |
| Transport Request | `src/lib/pdf/transport-request.tsx` | generated-document route | Migrated; normalized goods/equipment included |
| Fuel Consumption Summary | `src/lib/pdf/fuel-summary.tsx` | generated-document route | Migrated to tenant-branded shared system |
| Trip Completion | `src/lib/pdf/trip-completion.tsx` | generated-document route | Migrated to tenant-branded shared system |
| Departure/Return Inspection | `src/lib/pdf/inspection-report.tsx` | generated-document route | Migrated with real checklist/signatures |
| Maintenance Report | `src/lib/pdf/maintenance-report.tsx` | generated-document route | Migrated to tenant-branded shared system |
| Motor Vehicle Accident Report | `src/lib/pdf/mva-report.tsx` | generated-document route | Migrated to tenant-branded shared system |
| Incident / defect / breakdown | `src/lib/pdf/operational-records.tsx` | typed persisted `trip_incident_report` path | Added and wired to stored snapshots |
| Fuel receipt / verification | `src/lib/pdf/operational-records.tsx` | typed operational template | Added; uses natural verifier signatory |
| Driver logsheet | `src/lib/pdf/operational-records.tsx` | typed operational template | Added with executive certification |
| Driver Licence | `src/lib/pdf/driver-licence.tsx` | driver licence PDF route | Preserved; migrated to hardened branding resolver |
| Generic stored snapshot | `src/lib/pdf/snapshot-document.tsx` | generated-document fallback | Preserved for future/unknown document types using shared primitives |
| Reports and Trip Summary export | `src/lib/pdf/report.tsx` | Reports & Analytics API | Rebuilt on shared system; full rows, widths, pages, verification |
| Enhanced Analytics export | `src/lib/pdf/enhanced-report.tsx` | Enhanced Analytics API | Inspected and regression-preserved; its specialized chart/table renderer remains authoritative |

The missing fuel receipt, driver logsheet, incident/breakdown, and trip-summary templates were added without introducing a second PDF framework.

## Existing shared assets and utilities

- Tenant branding resolver: `src/lib/tenant-branding.ts`
- Human-readable values: `src/lib/human-readable.ts`
- Snapshot persistence and lifecycle generation: `src/lib/document-generator.ts`
- Hash, share-link, and verification data: generated document and share-link schemas
- Shared React-PDF primitives: `src/lib/pdf/document-system.tsx`
- Browser preview: `src/components/ui/pdf-preview.tsx`

No repository-owned Namibia Coat of Arms asset or repository-owned PDF font existed. The existing shared renderer fetched IBM Plex Mono and Allura from third-party hosts at render time. The hardened renderer must have a deterministic built-in-font fallback and must never depend on hotlinked fonts.

## React-PDF implementation findings

Current React-PDF documentation confirms:

- `fixed` repeats headers and footers on wrapped pages.
- `render={({ pageNumber, totalPages }) => ...}` is the supported dynamic page-number mechanism.
- `wrap={false}` keeps a block together; `minPresenceAhead` protects headings/sections from orphaning.
- images can use local server paths or data URIs.
- `renderToBuffer`/`renderToStream` produce the canonical server artifact.

The implementation therefore keeps one server generator as the source for Preview, Download, and Print, with all three consuming the same authenticated PDF response.

## Data-flow findings

- Transport requests persist activities, passengers, drivers, routes, attachments, special authority, and vehicle requirements.
- Goods/equipment had no normalized request model and was faked in Trip Authority generation from the purpose text.
- Generated documents already persist immutable snapshots and hashes.
- Employees include `isSignatory`; signatory positions already exist and are reset-aware, but official-document executive certification was not resolved/snapshotted centrally.
- Tenant logo URLs may be signed storage URLs and need a resilient server-side image resolver before rendering.

## Design decisions

1. Keep Trip Authority as a controlled Government-red form, with exact A–H sections.
2. Give all other documents a tenant-branded theme derived from stored branding colours.
3. Use explicit-width table definitions, safe display-value normalization, fixed continuation furniture, and final-page certification/verification blocks.
4. Store goods/equipment as normalized request rows so request, snapshot, approval, and authority documents share the same source.
5. Preserve historical names/titles/signatures in document snapshots.
6. Keep report UI structure and data logic intact; only replace rank colour noise with restrained semantic badges.
