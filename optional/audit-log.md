# Audit Log Specification

## Purpose

The audit log proves who did what, in which role, for which tenant and record, and when. It is evidence, not an editable activity feed.

## Events

Capture at least:

- login, logout, password change and suspension;
- tenant/office/role changes;
- staff import and corrections;
- vehicle create/update/status/odometer correction;
- request draft submission, revision, withdrawal, rejection and cancellation;
- route recalculation and manual override;
- allocation and replacement;
- every workflow action;
- emergency override;
- inspection submission and correction;
- physical issue and return;
- log/fuel add, edit and verification;
- trip closure/reopen;
- document generation/version/share/revoke/access;
- report export;
- permission-denied high-risk attempts.

## Event fields

- event ID and tenant sequence;
- tenant ID;
- actor user and employee ID;
- role-assignment ID and acting status;
- action and entity type/ID;
- timestamp;
- request/correlation ID;
- safe before/after summary or diff;
- reason/comment where required;
- source channel;
- previous hash and event hash.

Do not include passwords, raw tokens, full ID/licence values, fuel-card number or private file URLs.

## Hash chain

Canonicalise a safe JSON event payload and calculate an HMAC/SHA-256 hash using the previous tenant event hash and a server secret. Store both previous and current hash. A scheduled verifier checks sequence gaps and hashes.

The application database role may insert but not update/delete audit events. Platform maintenance requires a separate restricted database role and documented incident procedure.

## Corrections

Never edit an audit event. Create a correcting event that references the original.

## Retention

Permanent by default. Old operational data may be archived according to tenant policy, but the audit index and evidence reference remain.

## UI

- chronological timeline;
- filters by date, actor, action, entity and severity;
- permission-aware detail drawer;
- chain-verification status;
- CSV/PDF export for auditors;
- no delete/edit actions.
