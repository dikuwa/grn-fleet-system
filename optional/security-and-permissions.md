# Security and Permissions

## Security model

The system handles employee identity, licence, travel, vehicle and government operational data. Use least privilege, tenant isolation, defence in depth and permanent accountability.

## Permission matrix summary

| Capability | Requester | Supervisor | Transport Admin | Control Admin | Deputy Director | Director | CRO | Driver | Auditor |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Create own request | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes if staff | No |
| Approve supervisor stage | No | Scoped | No unless assigned, not own | No | No | No | No | No | No |
| Allocate vehicle | No | No | Yes | No | No | No | No | No | No |
| Regional release | No | No | No | Yes | No | No | No | No | No |
| Regional authorise | No | No | No | No | Yes | No | No | No | No |
| National release | No | No | No | No | No | Yes | No | No | No |
| National authorise | No | No | No | No | No | No | Yes | No | No |
| Perform inspection | Driver co-sign | No | Optional oversight | Yes | No | Configured national witness | No | Co-sign | Read |
| Add logs/fuel | Assigned only | No | Correct with audit | No | No | No | No | Assigned | Read |
| Close trip | No | No | Yes | No | No | No | No | Submit only | Read |
| Manage staff/vehicles | No | No | Yes | Limited if granted | No | No | No | No | Read |
| Audit read | Own request history | Scoped | Tenant | Scoped | Scoped | Scoped | Scoped | Own trip | Tenant |

Actual implementation uses permissions, office scope and role-assignment dates.

## Separation of duties

- Requester cannot approve own request.
- A person cannot perform release and final authorisation for the same trip.
- Acting roles do not bypass separation rules.
- Emergency override is a separate permission and event.
- Platform administrator does not inherit tenant approval capability.

## Sensitive fields

Restricted to authorised roles:

- national ID and licence number/document;
- fuel-card number;
- private phone/email;
- signature image;
- inspection/fuel receipt original URLs;
- internal comments;
- audit device/session detail.

UI masking is not enough; APIs and document snapshots must omit fields.

## External links

- 256-bit random token
- only token hash stored
- expiry and revocation
- optional view limit
- redaction profile
- rate limit
- no indexing
- `Referrer-Policy: no-referrer`
- minimal access log

## Password/session controls

- minimum length and compromised-password check where feasible;
- secure session cookies;
- rotate session after password change;
- revoke sessions on suspension;
- rate-limit login/reset;
- no password in logs or audit payload;
- optional stronger authentication can be added later.

## File security

- private buckets;
- presigned upload/download;
- allowlist MIME types;
- size limits;
- random storage keys;
- strip unsafe metadata where appropriate;
- virus scanning adapter documented for production expansion;
- content-disposition attachment for risky file types.

## Privacy

- collect only information required for official transport operations;
- external documents use redaction profiles;
- avoid analytics on sensitive internal pages;
- permanent audit retention applies to event evidence, not unlimited duplicate file copies;
- tenant retention policy may archive data but normal dashboard deletion cannot erase audit history.

## Headers

Use CSP, HSTS in production, `X-Content-Type-Options`, frame restrictions, Permissions Policy and secure referrer policy. Allow only required Google Maps, storage and monitoring origins.
