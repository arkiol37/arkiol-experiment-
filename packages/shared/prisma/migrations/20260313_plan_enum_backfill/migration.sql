-- ══════════════════════════════════════════════════════════════════════════════
-- 20260313_plan_enum_backfill
-- ══════════════════════════════════════════════════════════════════════════════
-- Ensures no Org or Workspace rows retain the deprecated STARTER or ENTERPRISE
-- plan values. Both resolve to their canonical equivalents:
--   STARTER    → CREATOR   (was the original paid entry plan)
--   ENTERPRISE → STUDIO    (was the original top-tier plan)
--
-- The Plan enum values themselves cannot be dropped from PostgreSQL without a
-- full enum recreation; they are retained as tombstones in the schema.
-- Application layer: resolvePlan() in packages/shared/src/plans.ts handles
-- any remaining runtime occurrences.
-- ══════════════════════════════════════════════════════════════════════════════

-- Arkiol Core: Org table
UPDATE "Org"
  SET plan = 'CREATOR'
  WHERE plan = 'STARTER';

UPDATE "Org"
  SET plan = 'STUDIO'
  WHERE plan = 'ENTERPRISE';

-- Animation Studio: workspaces table (lowercase enum values)
UPDATE "workspaces"
  SET plan = 'creator'
  WHERE plan IN ('starter', 'STARTER');

UPDATE "workspaces"
  SET plan = 'studio'
  WHERE plan IN ('enterprise', 'ENTERPRISE', 'scale', 'SCALE');

-- Animation Studio: users table (if plan is stored there too)
UPDATE "users"
  SET plan = 'creator'
  WHERE plan IN ('starter', 'STARTER')
    AND plan IS NOT NULL;

UPDATE "users"
  SET plan = 'studio'
  WHERE plan IN ('enterprise', 'ENTERPRISE', 'scale', 'SCALE')
    AND plan IS NOT NULL;

