-- packages/shared/prisma/migrations/20260307_v12_credit_reason_enum/migration.sql
-- ══════════════════════════════════════════════════════════════════════════════
-- ARKIOL AI v12 — CreditReason enum expansion
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Problem: The CreditReason PostgreSQL enum was missing values that the
-- application code (credits.ts) writes at runtime:
--   • static_hq           — HQ-upgraded static image credit cost
--   • asset_on_demand      — per on-demand AI sub-asset (standard quality)
--   • asset_on_demand_hq   — per on-demand AI sub-asset (HQ quality)
--   • asset_on_demand_refund — refund on failed on-demand asset job
--   • asset_3d             — 3D on-demand asset (ENABLE_3D_GENERATION gate)
--
-- Without these values any credit transaction for these reason types would
-- fail at the DB level with a PostgreSQL invalid-enum-value error, crashing
-- the generation pipeline and leaving orphaned jobs in RUNNING state.
--
-- All ALTER TYPE … ADD VALUE statements use IF NOT EXISTS so this migration
-- is safe to re-apply on databases that were partially migrated.
-- ══════════════════════════════════════════════════════════════════════════════

-- PostgreSQL requires each ADD VALUE in its own statement (no batching).
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'static_hq';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'asset_on_demand';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'asset_on_demand_hq';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'asset_on_demand_refund';
ALTER TYPE "CreditReason" ADD VALUE IF NOT EXISTS 'asset_3d';
