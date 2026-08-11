# Browser QA Report: GovFleet Official Document System

| Field | Value |
|---|---|
| Date | 11 August 2026 |
| App URL | `http://localhost:3000` |
| Session | `grn-official-docs` |
| Scope | Tenant signatory settings, request goods/equipment, reports, canonical PDF export/print, auth boundary, responsive and theme behavior |

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total open product issues** | **0** |

The first Settings load exposed a deployment-order problem: migrations 0053 and 0054 existed but were not registered in Drizzle's migration journal. The journal was corrected, the legacy migration ID sequence was synchronized, both additive migrations were applied, and the same tenant-administrator journey then passed after a clean reload.

## Passed journeys

1. Signed in as the seeded Tenant Administrator and reached the role-aware dashboard.
2. Added a goods/equipment row, entered description, quantity, and purpose, then removed it. All controls had usable accessible names.
3. Opened Tenant Settings → Branding, saved the executive signatory name and title, reloaded, and verified persistence.
4. Switched report type and reporting period and verified `aria-pressed` state followed the selected controls.
5. Requested the canonical PDF report and verified HTTP 200, `application/pdf`, attachment disposition, and a non-empty 66,339-byte artifact.
6. Used Print and verified it fetched the same canonical PDF endpoint without a browser error.
7. Requested that PDF from an unauthenticated session and received `Authentication required`.
8. Tested Reports at 390 × 844 in light and dark modes; document width stayed inside the viewport and the restrained rank treatment remained readable.
9. Checked browser errors after the journeys; no application exception remained.

## Evidence

- `screenshots/dashboard-desktop.png`
- `screenshots/request-goods-equipment-filled.png`
- `screenshots/settings-branding-signatory.png`
- `screenshots/reports-desktop.png`
- `screenshots/reports-trip-summary-7d.png`
- `screenshots/reports-mobile-dark.png`
- `screenshots/reports-mobile-light.png`

