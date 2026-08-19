-- Allow the same person to participate in multiple tenants while keeping
-- duplicate *open* invitations within one tenant impossible.
--
-- The previous unique(email, status) index was global. That meant an invitee
-- could not have the same invitation state in two organisations and, more
-- seriously, a second accepted invitation could collide with the first one.

DROP INDEX IF EXISTS "tenant_invitations_email_status_idx";

-- Invitation creation already normalises addresses. Normalise historical rows
-- before applying the tenant-scoped guard so casing cannot create duplicates.
UPDATE "tenant_invitations"
SET
  "email" = lower(trim("email")),
  "updated_at" = now()
WHERE "email" <> lower(trim("email"));

-- Older data may contain both a pending and a sent invitation for the same
-- tenant/email because the old index treated those as different statuses.
-- Keep the most recent open invitation and cancel older duplicates rather than
-- deleting audit/history records.
WITH ranked_open_invitations AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "email"
      ORDER BY COALESCE("sent_at", "created_at") DESC, "created_at" DESC, "id" DESC
    ) AS rn
  FROM "tenant_invitations"
  WHERE "status" IN ('pending', 'sent')
)
UPDATE "tenant_invitations" AS invitation
SET
  "status" = 'cancelled',
  "updated_at" = now()
FROM ranked_open_invitations AS ranked
WHERE invitation."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_invitations_open_tenant_email_idx"
ON "tenant_invitations" ("tenant_id", "email")
WHERE "status" IN ('pending', 'sent');
