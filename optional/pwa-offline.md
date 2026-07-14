# PWA and Offline Draft Specification

## Scope

Offline support is limited to driver logsheet drafts and selected inspection draft preparation. Approvals, allocation, final submission, vehicle issue, sharing and user administration require connectivity.

## Storage

Use Dexie/IndexedDB. Each record includes:

- local client ID;
- server entity ID if known;
- tenant ID;
- user ID;
- trip ID;
- base server version;
- data;
- updated timestamp;
- sync state and error.

## Security

- Clear local drafts on logout or tenant switch after warning/sync attempt.
- Do not cache full employee directory or licence documents.
- Store the minimum required trip context.
- Avoid persistent auth tokens in IndexedDB.

## Sync

- Background/foreground sync when online.
- Idempotency by client ID.
- Server validates assignment, trip status and base version.
- Conflicts show side-by-side safe fields and require user choice.
- Submitted server records are immutable except through correction flow.

## UI

- global offline banner;
- per-draft `Saved on this device`, `Pending sync`, `Synced`, `Conflict`, `Failed` badges;
- manual retry;
- last successful sync time;
- prevent user from believing a local draft is officially submitted.

## Service worker

Cache static shell, fonts and safe public assets. Use network-first for authenticated data and do not cache private API responses broadly. Version caches and show update prompt when a new application build is ready.
