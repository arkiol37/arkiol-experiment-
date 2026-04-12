-- Migration: 20260310_cinematic_ad_mode
-- Adds cinematic ad mode tracking to render_jobs.
-- No breaking changes — all new columns are nullable with defaults.

-- Track which ad style was used for analytics and billing audits
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS ad_style VARCHAR(20) DEFAULT 'normal'
    CHECK (ad_style IN ('normal', 'cinematic'));

-- Track cinematic-specific enrichment metadata (descriptor JSON)
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS cinematic_descriptor JSONB DEFAULT NULL;

-- Track the cinematic render time overhead for cost analysis
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS cinematic_render_overhead_ms INTEGER DEFAULT NULL;

-- Index for analytics queries (ad style distribution)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_render_jobs_ad_style
  ON render_jobs(ad_style)
  WHERE ad_style IS NOT NULL;

-- Index for workspace + ad_style analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_render_jobs_workspace_ad_style
  ON render_jobs(workspace_id, ad_style, created_at DESC);
