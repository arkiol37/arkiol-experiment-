-- ══════════════════════════════════════════════════════════════════════════════
-- 20260312_launch_enum_cleanup
-- ══════════════════════════════════════════════════════════════════════════════
-- Remove pre-launch enum values no longer part of the product:
--   • CreditReason: asset_3d, video_long  → replaced by normal_ad, cinematic_ad
--   • JobType: RENDER_VIDEO_LONG, STUDIO_RENDER_3D → replaced by RENDER_NORMAL_AD,
--              RENDER_CINEMATIC_AD, STUDIO_RENDER_CINEMATIC
--
-- Safe migration strategy:
--   1. Remap any existing rows using removed values to their launch equivalents.
--   2. Add the new enum values (idempotent ADD VALUE IF NOT EXISTS).
--   3. We do NOT DROP old enum values — PostgreSQL requires full enum replacement
--      for that, which is risky in production. Instead the old values become
--      dead-code: no new rows will use them (enforced at application layer).
--      A future cleanup migration can remove them after confirming zero usage.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Remap CreditReason rows ────────────────────────────────────────────────
-- Backfill asset_3d → cinematic_ad (closest equivalent)
UPDATE "CreditLedger"
  SET   reason = 'cinematic_ad'
  WHERE reason = 'asset_3d';

-- Backfill video_long → cinematic_ad
UPDATE "CreditLedger"
  SET   reason = 'cinematic_ad'
  WHERE reason = 'video_long';

-- ── Add launch CreditReason values ────────────────────────────────────────
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'normal_ad';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'cinematic_ad';

-- ── Remap JobType rows ─────────────────────────────────────────────────────
-- Backfill RENDER_VIDEO_LONG → RENDER_CINEMATIC_AD
UPDATE "Job"
  SET   type = 'RENDER_CINEMATIC_AD'
  WHERE type = 'RENDER_VIDEO_LONG';

-- Backfill STUDIO_RENDER_3D → STUDIO_RENDER_CINEMATIC
UPDATE "Job"
  SET   type = 'STUDIO_RENDER_CINEMATIC'
  WHERE type = 'STUDIO_RENDER_3D';

-- ── Add launch JobType values ──────────────────────────────────────────────
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RENDER_NORMAL_AD';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RENDER_CINEMATIC_AD';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'STUDIO_RENDER_CINEMATIC';

-- ── Update workspace plan enum (if still using legacy values) ─────────────
-- Remap scale → studio, enterprise → studio in any remaining rows
DO $$
BEGIN
  -- Only run on PostgreSQL (guard for SQLite test environments)
  IF current_setting('server_version_num')::int >= 90000 THEN
    UPDATE workspaces SET plan = 'studio'  WHERE plan IN ('scale', 'enterprise');
  END IF;
END
$$;
