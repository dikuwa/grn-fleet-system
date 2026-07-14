# API Specification

## Principles

- REST-style Next.js route handlers under `/api/v1`
- JSON except file upload/download and rendered documents
- Session authentication for dashboard APIs
- Hashed bearer token only for external share endpoints
- Zod validation
- Capability and tenant checks in domain services
- Idempotency keys for sync, import commit and repeated workflow actions
- Optimistic concurrency through `version` or `If-Match`

## Standard responses

Success:

```json
{ "data": {}, "meta": { "requestId": "uuid" } }
```

Paginated:

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 25, "total": 0, "totalPages": 0, "requestId": "uuid" }
}
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Review the highlighted fields.",
    "fieldErrors": {},
    "requestId": "uuid"
  }
}
```

Use 401, 403, 404, 409, 422 and 429 accurately. Cross-tenant object access should avoid revealing existence.

## Core endpoints

### Auth and session

- `GET /api/v1/session`
- `POST /api/v1/auth/change-initial-password`
- Better Auth handlers under framework route

### Tenants and organisation

- `GET/POST /api/v1/platform/tenants`
- `GET/PATCH /api/v1/tenant/settings`
- `GET/POST/PATCH /api/v1/offices`
- `GET/POST/PATCH /api/v1/departments`
- `GET/POST/PATCH /api/v1/roles`
- `GET/POST/PATCH /api/v1/role-assignments`

### Employees and imports

- `GET/POST /api/v1/employees`
- `GET/PATCH /api/v1/employees/:id`
- `POST /api/v1/imports/presign`
- `POST /api/v1/imports`
- `GET /api/v1/imports/:id`
- `PATCH /api/v1/imports/:id/rows/:rowId`
- `POST /api/v1/imports/:id/commit`
- `POST /api/v1/employees/:id/activate-user`

### Fleet

- `GET/POST /api/v1/vehicles`
- `GET/PATCH /api/v1/vehicles/:id`
- `GET /api/v1/vehicles/availability`
- `POST /api/v1/vehicles/:id/defects`
- `POST /api/v1/vehicles/:id/maintenance`
- `POST /api/v1/vehicles/:id/status`

### Requests

- `GET/POST /api/v1/requests`
- `GET/PATCH /api/v1/requests/:id`
- `POST /api/v1/requests/:id/submit`
- `POST /api/v1/requests/:id/withdraw`
- `POST /api/v1/requests/:id/revise`
- `POST /api/v1/requests/:id/cancel`
- `POST /api/v1/routes/compute`
- `POST /api/v1/requests/:id/recommend-vehicle`

### Workflow and approvals

- `GET /api/v1/approvals/inbox`
- `POST /api/v1/requests/:id/actions/approve`
- `POST /api/v1/requests/:id/actions/reject`
- `POST /api/v1/requests/:id/actions/return`
- `POST /api/v1/requests/:id/actions/release`
- `POST /api/v1/requests/:id/actions/authorise`
- `POST /api/v1/requests/:id/actions/acknowledge`
- `POST /api/v1/requests/:id/emergency-override`

The server derives the allowed current action; clients cannot pass an arbitrary next status.

### Allocation and authority

- `POST /api/v1/requests/:id/allocation`
- `PATCH/DELETE /api/v1/allocations/:id`
- `PUT /api/v1/requests/:id/trip-authority`

### Inspections and issue

- `POST /api/v1/trips/:id/inspections`
- `PATCH /api/v1/inspections/:id`
- `POST /api/v1/inspections/:id/submit`
- `POST /api/v1/trips/:id/issue`

### Driver logs and sync

- `GET /api/v1/me/trips`
- `GET /api/v1/trips/:id/logs`
- `POST /api/v1/trips/:id/logs`
- `POST /api/v1/sync/logs` with idempotent client IDs

Conflict response:

```json
{
  "error": {
    "code": "SYNC_CONFLICT",
    "message": "The server record changed after this draft was created.",
    "serverVersion": {},
    "clientVersion": {}
  }
}
```

### Fuel and closure

- `POST /api/v1/trips/:id/fuel`
- `PATCH /api/v1/fuel/:id`
- `POST /api/v1/trips/:id/return`
- `POST /api/v1/trips/:id/close`
- `POST /api/v1/trips/:id/reopen` restricted and audited

### Files

- `POST /api/v1/files/presign-upload`
- `POST /api/v1/files/complete`
- `GET /api/v1/files/:id/download`

### Documents and sharing

- `POST /api/v1/documents/generate`
- `GET /api/v1/documents/:id`
- `POST /api/v1/documents/:id/share-links`
- `DELETE /api/v1/share-links/:id` (revoke)
- `GET /share/:token` public redacted view
- `GET /api/v1/verify/:reference` minimal verification record

### Notifications

- `GET /api/v1/notifications`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`

### Reports

- `GET /api/v1/reports/:reportKey`
- `POST /api/v1/reports/:reportKey/export`
- `GET /api/v1/exports/:id`

### Audit

- `GET /api/v1/audit-events`
- `POST /api/v1/audit/verify-chain` platform/tenant auditor only

## External adapter contracts

Wrap Maps, email, storage, background jobs, Redis and optional AI behind typed interfaces. Route handlers must not call vendor SDKs directly. This enables future government hosting and provider replacement.
