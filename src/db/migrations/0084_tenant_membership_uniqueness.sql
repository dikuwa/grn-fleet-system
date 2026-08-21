-- A Better Auth account may belong to multiple tenants, but it must only have
-- one membership row inside each tenant. Older data can contain duplicate rows
-- because tenant_memberships previously had no uniqueness constraint.

-- Build a canonical membership mapping for every tenant/user group. Prefer the
-- membership that currently grants the most usable access, then the earliest
-- membership.
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
    ) AS canonical_id
  FROM "tenant_memberships"
), ranked_assignments AS (
  SELECT
    assignment."id",
    membership."canonical_id",
    row_number() OVER (
      PARTITION BY membership."canonical_id", assignment."role_id"
      ORDER BY
        CASE WHEN assignment."tenant_membership_id" = membership."canonical_id" THEN 0 ELSE 1 END,
        assignment."start_date" ASC,
        assignment."id" ASC
    ) AS rn
  FROM "role_assignments" AS assignment
  INNER JOIN ranked_memberships AS membership
    ON membership."id" = assignment."tenant_membership_id"
)
DELETE FROM "role_assignments" AS assignment
USING ranked_assignments AS ranked
WHERE assignment."id" = ranked."id"
  AND ranked.rn > 1;

-- Reparent the remaining non-colliding role history to the canonical membership.
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
    ) AS canonical_id
  FROM "tenant_memberships"
)
UPDATE "role_assignments" AS assignment
SET "tenant_membership_id" = membership."canonical_id"
FROM ranked_memberships AS membership
WHERE assignment."tenant_membership_id" = membership."id"
  AND membership."id" <> membership."canonical_id";

-- Remove only duplicate membership rows after their role assignments have been
-- safely consolidated onto the canonical membership.
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
