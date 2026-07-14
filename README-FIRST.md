# Namibia Government Fleet Management System — Read First

> **Working product name:** GovFleet Namibia  
> **Initial tenant:** Kavango East Regional Council  
> **Package mode:** PACKAGE completed; implementation has not started  
> **Implementation execution:** CONTINUOUS AUTO-BUILD  
> **VibeKit/JB selection:** A — Full VibeKit foundation, with approved project-specific exceptions  
> **Approval status:** Approved by the project owner on 2026-07-14

## What this package is

This folder is the complete implementation specification for a multi-tenant government fleet-management platform. It translates the approved discovery decisions, supplied paper forms, staff source document, dashboard references, and operating rules into a build-ready package for an AI coding agent or human development team.

This package is not an application build. The coding agent must use it to create the application in a new repository and continue automatically through the phases without asking for ordinary phase-by-phase confirmation.

## Start here

Read in this exact order:

1. `README-FIRST.md`
2. `MASTER-CODER-PROMPT.md`
3. `project-description.md`
4. `design-style-guide.md`
5. `architecture.md`
6. `component-plan.md`
7. `optional/business-workflow.md`
8. `optional/database-design.md`
9. `optional/security-and-permissions.md`
10. `project-phases.md`
11. `CODER-RULES.md`
12. `testing-plan.md`
13. `pre-deployment.md`
14. `env-setup.md`

Read the remaining optional documents before implementing their related modules.

## Conflict priority

When instructions conflict, use this order:

1. The user's latest approved requirement
2. `project-description.md`
3. `design-style-guide.md`
4. `architecture.md`
5. Project-specific optional specifications
6. `project-phases.md`
7. `CODER-RULES.md`
8. VibeKit/JB guidance
9. Framework defaults

## VibeKit adoption note

The project uses the VibeKit planning, build discipline, component-registry workflow, coding conventions, and production safeguards as its foundation. The approved architecture intentionally differs from the VibeKit default in several places:

- **Drizzle ORM** is used instead of Prisma.
- Redis is limited to rate limiting and short-lived coordination rather than broad application caching.
- Stripe and payments are excluded.
- WhatsApp API and active SMS are excluded.
- Authentication is password-based with no public sign-up and no mandatory two-factor authentication in the prototype.

These are approved project decisions, not omissions.

## Auto-build rule

After receiving this package, the coding agent must:

- create the repository;
- verify current compatible stable package versions;
- scaffold the approved foundation;
- implement phases in order;
- test every phase;
- fix failures before continuing;
- update `PROJECT-STATUS.md` and `CHANGELOG.md` continuously;
- proceed without asking for normal confirmation.

Stop only for a genuine blocker: missing paid-service approval, unavailable credentials, destructive production action, unresolved legal requirement, or a business contradiction that cannot be safely inferred.

## Source materials

Relevant supplied source materials are indexed in `source-materials/README.md`. They include dashboard visual references, the staff list, the programme-of-activities form, the logsheet, trip-authority photographs, and a fuel receipt. The unrelated school finance document was deliberately excluded.

## Current phase

**Package approved. Implementation not started.**

The next action is to place this package in a new project workspace and paste `MASTER-CODER-PROMPT.md` into the coding agent.
