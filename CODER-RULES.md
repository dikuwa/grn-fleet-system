# Coder Rules

1. Build from the approved package; do not restart discovery.
2. Use continuous auto-build and internal quality gates.
3. Keep scope within v1 unless an addition is required for security or correctness.
4. Never expose secrets, private storage keys or service credentials.
5. Never trust client-provided tenant, user, role, price, distance, approval or status data.
6. Every tenant-owned query must be tenant-scoped.
7. Every write must pass server-side permission and domain-rule checks.
8. Never use role names alone where a capability check is required.
9. Enforce separation of duties and self-approval restrictions in domain services and tests.
10. Use database transactions for state transitions, allocation and audit creation.
11. Preserve workflow definition versions for active and historical requests.
12. Do not silently change approved documents after issue; version them.
13. Use non-destructive migrations and explicit data backfills.
14. Do not add dependencies without a clear need and documented reason.
15. Inspect and merge VibeKit/JB registry output; never overwrite blindly.
16. Server Components by default; Client Components only where interaction requires them.
17. Do not fetch sensitive data in the browser if the server can render it.
18. Do not create duplicate data-fetching paths for the same entity.
19. Validate all input with Zod on the server.
20. Validate uploads by type, size and tenant context.
21. Use signed private URLs and short expiries.
22. Do not store raw share tokens; store cryptographic hashes.
23. No public sign-up.
24. No compulsory two-factor authentication in v1.
25. No automated WhatsApp API or active SMS.
26. WhatsApp actions only open/share a secure link.
27. Google Routes is authoritative for mapped distance; manual overrides require a reason.
28. AI recommendations are advisory and must be explainable.
29. Offline data is draft-only; final approval/issue requires connectivity.
30. Use idempotency for imports, sync, email jobs and repeated actions.
31. Use optimistic concurrency for request/trip/vehicle changes.
32. Never use browser `alert`, `prompt` or `confirm`.
33. Every async action needs loading and disabled states.
34. Every page needs loading, empty, error, success and permission-denied handling.
35. Tables require pagination and responsive alternatives.
36. Use accessible labels, focus states and semantic HTML.
37. Respect reduced motion.
38. Keep UI compact and consistent with the design guide.
39. Use real database data in production paths.
40. Seed data must be clearly fictional or imported through a review flow.
41. Preserve historical records when users, roles, employees or vehicles are suspended.
42. Audit events are append-only.
43. Avoid logging raw IDs, licences, passwords, tokens and document URLs.
44. Add tests for every permission and workflow transition.
45. Run lint, type-check, tests and production build before each phase completion.
46. Update status and changelog truthfully; never mark untested work complete.
47. Complete pre-deployment review before production.
48. Do not claim legal certification for stored signatures.
49. The public site must not claim official national adoption.
50. Stop only for a genuine blocker defined in `MASTER-CODER-PROMPT.md`.
