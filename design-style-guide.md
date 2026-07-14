# Design Style Guide

## 1. Visual direction

The application should feel like a modern, trustworthy government operations system: disciplined, compact, clear and premium without becoming decorative. The supplied dashboard references show blue institutional navigation, strong page hierarchy, compact KPI cards, data-heavy tables, restrained charts and clear status badges. The system must borrow this visual language without reproducing a reference layout.

### Adopt

- strong left navigation for desktop;
- clean top bar with search, notifications and profile;
- compact cards with light borders;
- readable tables with strong column rhythm;
- status chips with icon/dot plus text;
- clear primary actions and restrained secondary actions;
- mobile conversion from tables to structured cards;
- subtle, functional charts.

### Adapt

- reduce the oversized marketing-style whitespace seen in some references;
- use government workflow language rather than generic logistics wording;
- provide more explicit process timelines and approval ownership;
- use mobile forms for drivers instead of desktop report layouts;
- give the landing page greater visual presence while keeping the dashboard restrained.

### Avoid

- copying any logo, text, metric or table exactly;
- generic purple SaaS styling;
- excessive gradients, glassmorphism or glowing effects;
- large rounded cards everywhere;
- decorative blobs;
- heavy shadows;
- unnecessary animation;
- icon-only actions without labels/tooltips;
- browser-default selects, date inputs, alerts or confirms.

## 2. Brand personality

- Authoritative
- Dependable
- Efficient
- Accountable
- Calm
- Accessible
- Namibian and public-sector appropriate

The working title and pilot branding must be replaceable per tenant.

## 3. Theme

**Light theme only for v1.** A dark theme adds testing and accessibility overhead without an approved requirement. Architecture may keep semantic tokens so dark mode can be added later.

## 4. Typography

Use **Onest** through `next/font/google` for the application and generated PDFs. It provides compact shapes, readable numerals and good small-size legibility.

| Token | Desktop | Mobile | Weight | Use |
|---|---:|---:|---:|---|
| Display | 48px | 36px | 650 | Landing hero |
| H1 | 30px | 26px | 650 | Dashboard page title |
| H2 | 24px | 22px | 650 | Major section |
| H3 | 19px | 18px | 600 | Card/dialog title |
| Body | 14px | 14px | 400 | Default UI text |
| Body small | 13px | 13px | 400 | Tables/meta |
| Caption | 12px | 12px | 500 | Badges/timestamps |
| Micro | 11px | 11px | 650 | Uppercase labels |

Rules:

- headings use tight line-height and subtle negative tracking;
- body line-height 1.45–1.55;
- use tabular numerals for kilometres, odometers, dates, fuel and money;
- do not use ultra-bold weights in dashboard chrome;
- abbreviations must have accessible labels.

## 5. Colour tokens

### Core brand

| Token | Hex | Use |
|---|---|---|
| `brand-950` | `#102A4C` | deepest navigation and hero text |
| `brand-900` | `#163A69` | sidebar background |
| `brand-800` | `#1F4E8C` | primary institutional blue |
| `brand-700` | `#2862AA` | primary hover |
| `brand-600` | `#3478C8` | links/secondary accent |
| `brand-100` | `#DCEBFA` | selected backgrounds |
| `brand-50` | `#F1F7FD` | page accents |

### Secondary accent

| Token | Hex | Use |
|---|---|---|
| `teal-700` | `#0F766E` | verified/safe operational accent |
| `teal-50` | `#ECFDF5` | subtle positive surface |

### Neutral

| Token | Hex | Use |
|---|---|---|
| `ink-950` | `#111827` | headings |
| `ink-700` | `#374151` | body |
| `ink-500` | `#6B7280` | secondary text |
| `surface` | `#FFFFFF` | cards/dialogs |
| `canvas` | `#F6F8FB` | application background |
| `muted` | `#F0F3F7` | table headers/rails |
| `border` | `#D9E0E8` | borders/dividers |

### Semantic

| Status | Background | Text |
|---|---|---|
| Success/authorised | `#ECFDF3` | `#067647` |
| Pending/action needed | `#FFF7E6` | `#B54708` |
| Information | `#EAF2FF` | `#175CD3` |
| Rejected/error | `#FEF3F2` | `#B42318` |
| Cancelled/neutral | `#F2F4F7` | `#475467` |
| Emergency | `#FFF1F3` | `#C01048` |

Statuses must use text plus icon or dot, never colour alone.

## 6. Spacing and density

Use a 4px increment system with an 8px primary rhythm.

- Input height: 40px desktop, 44px touch contexts
- Compact table row: 44px
- Comfortable mobile list row: minimum 52px
- Card padding: 16–20px
- Page section gap: 24px
- Form field gap: 14px
- Inline gap: 8px
- Dashboard max content width: 1440px
- Landing content width: 1200px
- Desktop page padding: 24–32px
- Mobile page padding: 16px

Prefer useful density. Do not create long pages by adding decorative empty space.

## 7. Radius, borders and shadows

- Inputs/buttons: 8px radius
- Cards: 10–12px radius
- Dialogs/drawers: 14px radius
- Pills/badges: full radius
- Default border: 1px solid `border`
- Default card shadow: none or very subtle (`0 1px 2px rgba(16,42,76,.05)`)
- Elevated overlay: restrained shadow only

Selected states should be obvious through background, border and text—not shadow alone.

## 8. Layout

### Desktop

- Expanded sidebar: 248px
- Collapsed sidebar: 72px
- Sticky top bar: 64px
- Main content fluid with max-width
- Page header: title/description on left, primary actions on right
- Detail pages: main content plus 320–360px context rail where useful

### Tablet

- Collapsible icon sidebar or drawer
- Two-column grids collapse to one or two logical sections
- Data tables may keep horizontal scrolling only when comparison is essential

### Mobile

- Navigation drawer
- Sticky high-priority actions only when safe
- Tables convert to cards or labelled rows
- Forms use one column
- Timelines remain vertical
- Driver actions place primary controls near the thumb zone

## 9. Navigation

Primary groups:

- Overview
- Requests & Approvals
- Trips & Driver Logs
- Fleet & Maintenance
- People & Offices
- Documents & Reports
- Administration

Use Lucide line icons at 18–20px. Keep icon and label in the same row. Active state uses brand-100 background, brand-800 text and a subtle inset marker.

## 10. Cards

Cards are containers for a clear purpose, not decoration.

- title, optional description and action aligned in one header row;
- metrics use tabular numerals;
- avoid more than four KPI cards in one row;
- use border and surface contrast rather than large shadow;
- card clickability must be clear and accessible.

## 11. Buttons

- Primary: brand-800 filled, white text
- Secondary: white surface, brand/ink text, border
- Tertiary: text or ghost
- Destructive: error styling
- Emergency: distinct but not used as a general primary button

Button height: 40px default, 36px compact. Every asynchronous button shows a spinner and preserves label context.

## 12. Forms

- Labels above fields
- Required indicator and optional text explained clearly
- Inline helper text only when useful
- Validation appears near the field and in an accessible summary for long forms
- Use searchable comboboxes for staff, vehicles and locations
- Use custom date/time pickers
- Multi-step request wizard saves draft automatically online
- Show route distance, additional kilometres and total in a compact calculation card
- Use expandable sections for optional drivers, passengers and special authority

## 13. Tables and lists

- Sticky header where data density justifies it
- Strong primary column
- Secondary text below primary values
- Right-align numeric fields
- Use compact status badges
- Keep actions in a labelled menu
- Provide search, filters, export and column visibility
- Persist filters in the URL
- Mobile uses card/list representation rather than squeezed columns

## 14. Workflow timeline

Each request detail page includes a vertical or horizontal stepper showing:

- completed stages;
- current responsible role;
- pending stage;
- rejected/cancelled state;
- emergency override marker;
- timestamps and comments.

The current action card must be visually distinct from the historical timeline.

## 15. Dialogs and drawers

- Use dialogs for focused confirmations and small edits
- Use right drawers for contextual detail without losing list position
- Use full-page flows for transport request, inspections and complex imports
- Destructive confirmations require explicit typed or selected acknowledgement when risk is high

## 16. Toasts and feedback

Use concise toasts for success and recoverable failures. Persistent problems use inline alerts. Do not rely on a toast for critical approval or data-loss warnings.

## 17. Loading and empty states

- Skeletons should match final layout
- Empty states explain why data is empty and provide the correct action
- No-results states preserve filters and offer reset
- Offline state uses a visible banner and per-record sync badge
- Permission-denied states explain the required role without exposing sensitive data

## 18. Images and documents

- Vehicle photos use consistent 4:3 crops
- Inspection photos show timestamp, stage and uploader
- Document previews sit on a neutral canvas and display the full page
- Landing imagery may use real Namibian roads, government fleet context and regional landscapes; avoid generic delivery vans with foreign branding
- No text embedded in marketing images

## 19. Motion

- 150–220ms transitions
- Use motion for drawers, status changes, list entry and progress feedback
- Respect `prefers-reduced-motion`
- No continuous decorative animation in the dashboard

## 20. Accessibility

- WCAG 2.2 AA target
- keyboard-accessible navigation, menus, dialogs and tables
- visible focus rings
- minimum 44px touch target in driver/mobile contexts
- semantic headings and landmarks
- descriptive labels for signature, photos and status
- contrast verified in both default and disabled states
- do not use colour alone to communicate approval status

## 21. Landing-page direction

The landing page may use a restrained blue radial wash, full-width hero, process illustration, product dashboard crops, government-readiness section, security/accountability section and a strong demonstration CTA. Avoid fake customer logos and unverified national claims.
