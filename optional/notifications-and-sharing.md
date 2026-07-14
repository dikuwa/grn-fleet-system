# Notifications and Sharing

## Notification types

- Awareness: a request exists; no action button.
- Action required: current officer must act.
- Outcome: approved, rejected, cancelled, allocated, authorised or closed.
- Reminder: action pending for configured working time.
- Escalation: action overdue.
- Operational: inspection, log, fuel or return required.
- Risk: licence expiry, overdue vehicle, defect or anomaly.
- Emergency: bypasses quiet hours.

## Delivery

### In-app

Database-backed, immediate after transaction, unread count and notification centre. Link directly to the relevant record/action.

### Email

Use React Email templates with tenant branding. Email must contain enough context to act but avoid sensitive ID/licence details. Link to authenticated dashboard.

### WhatsApp/manual share

No API. The user creates or selects a secure link, then:

- uses Web Share API where available;
- opens `wa.me`/WhatsApp share URL with prefilled non-sensitive message;
- copies the link;
- sends email;
- downloads PDF.

## Reminder defaults

- reminder after two working hours;
- escalation after four working hours;
- tenant-configurable;
- use business-day calendar and quiet hours;
- emergency bypass.

## Idempotency

Each delivery has a unique event/recipient/channel key. Retries must not create duplicate in-app notifications or emails.

## Share-link controls

- expiry choices: 24 hours, 7 days, 30 days or custom within tenant limit;
- revocation;
- optional view limit;
- redaction profile;
- audit access;
- rate limit;
- no raw token in database;
- no search indexing.
