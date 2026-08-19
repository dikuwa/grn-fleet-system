-- A Better Auth account may belong to multiple tenants, but it must only have
-- one membership row inside each tenant. Older data can contain duplicate rows
-- because tenant_memberships previously had no uniqueness constraint.

-- Choose one canonical membership per tenant/user. Prefer the membership that
-- currently grants the most usable access, then the earliest membership.
WITH ranked_memberships AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "tenant_id", "user_id"
      ORDER BY
        CASE "status"
          WHEN 'active' THEN 0
          WHEN 'pending_activation' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'suspended' THEN 3
          WHEN 'access_removed' THEN 4
          ELSE 5
        END,
        "joined_at" ASC,
        "id" ASC
    ) AS canonical_id,
    row_number() OVER (
      PARTITION BY "tenant_id", "user_id"
      ORDER BY
        CASE "status"
          WHEN 'active' THEN 0
          WHEN 'pending_activation' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'suspended' THEN 3
          WHEN 'access_removed' THEN 4
          ELSE 5
        END,
        "joined_at" ASC,
        "id" ASC
    ) AS rn
  FROM "tenant_memberships"
), duplicate_memberships AS (
  SELECT "id", "canonical_id"
  FROM ranked_memberships
  WHERE rn > 1
)
UPDATE "role_assignments" AS assignment
SET "tenant_membership_id" = duplicate."canonical_id"
FROM duplicate_memberships AS duplicate
WHERE assignment."tenant_membership_id" = duplicate."id";

-- Remove only the duplicate membership rows after their role history has been
-- moved to the canonical membership. Staff records reference the global user,
-- not the membership row, so no employee identity is lost.
WITH ranked_memberships AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "user_id"
      ORDER BY
        CASE "status"
          WHEN 'active' THEN 0
          WHEN 'pending_activation' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'suspended' THEN 3
          WHEN 'access_removed' THEN 4
          ELSE 5
        END,
        "joined_at" ASC,
        "id" ASC
    ) AS rn
  FROM "tenant_memberships"
)
DELETE FROM "tenant_memberships" AS membership
USING ranked_memberships AS ranked
WHERE membership."id" = ranked."id"
  AND ranked.rn > 1;

-- Production already has this historical invariant under this name. Keeping
-- the canonical name makes this migration a no-op there while fresh databases
-- receive the same protection.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenant_user_unique"
ON "tenant_memberships" ("tenant_id", "user_id");
