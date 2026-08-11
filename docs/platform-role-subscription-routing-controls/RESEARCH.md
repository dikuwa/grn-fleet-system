# Platform Role, Subscription, and Routing Controls Research

## Overview

This change separates platform authority from tenant role administration, improves package decision context, and allows tenant workflow steps to be reordered safely.

## Problem Statement

- Tenant role screens currently expose platform-only roles from the shared platform tenant.
- Subscription changes show package names without enough pricing or capacity context.
- Workflow definitions are versioned in the database but the administration screen only edits assignees and scope in place.

## User Stories / Use Cases

- A Tenant Administrator sees and edits only tenant roles and tenant permissions.
- A Platform Super Administrator delegates support or audit work without allowing those users to alter super-administrator access.
- A Platform Super Administrator can compare price, billing interval, trial and primary limits while changing a tenant package.
- A Tenant Administrator can rearrange approval steps, review the resulting order, and confirm the change before it affects new requests.

## Technical Research

### Approach Options

1. Hide platform roles only in the tenant UI. This is insufficient because crafted API requests could still read or mutate them.
2. Filter and protect platform roles in the tenant API, with platform assignments managed by the existing Platform Users area. This is the smallest secure boundary.
3. Update workflow step order in place. This risks changing the meaning of in-progress workflow instances.
4. Publish a new workflow definition version when order changes. Existing instances retain their definition while new requests use the new active version.

### Recommended Approach

Use server-side role classification for all tenant role reads and writes. Keep platform role definitions system-managed and manage assignments only through Platform Users. Publish reordered workflow definitions as a new version, preserving active request history. Keep Driver Acknowledgement terminal because it depends on an authorised trip and assigned vehicle.

### Required Technologies

No new dependency is required. Existing Next.js route handlers, Drizzle models, confirmation dialog, and theme tokens cover the feature.

### Data Requirements

No schema migration is required. Workflow definition version, active state, and definition foreign keys already provide immutable routing history.

## UI/UX Considerations

- Provide accessible move-up/move-down controls instead of pointer-only drag behavior.
- Show an unsaved-change cue and a typed confirmation phrase in the existing red quoted style.
- Present compact package comparison cards with interval-aware price and major limits.

## Integration Points

- Tenant roles API and Roles & Permissions screen.
- Platform Users API and page.
- Platform subscription package API data and subscription dialogs.
- Workflow Routing page, route handler, workflow engine definition resolution, and audit log.

## Risks and Challenges

- In-progress workflow corruption: mitigated by versioned publication.
- Privilege escalation via direct API calls: mitigated by server-side role guards.
- Invalid workflow semantics: Driver Acknowledgement remains the terminal step.

## Open Questions

None blocking. Platform role permission-template editing remains intentionally system-managed; assignment is already handled in Platform Users.

## References

- Existing codebase workflow schema and engine behavior.
- Existing platform user continuity controls and typed-confirmation component.
