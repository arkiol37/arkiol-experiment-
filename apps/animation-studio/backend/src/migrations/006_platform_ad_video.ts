/**
 * Migration 006 — Platform Ad Video
 *
 * Adds:
 *   render_jobs.placement          — AdPlacement enum value ('youtube_instream', etc.)
 *   render_jobs.platform           — Platform shorthand ('youtube','facebook','instagram','tiktok')
 *   render_jobs.platform_exports   — JSONB map of placement → CDN URLs per export format
 *   render_jobs.ad_duration_sec    — Total ad duration in seconds
 *   render_jobs.hook_type          — Hook psychology type used
 *   render_jobs.cta_text           — CTA text used in final scene
 *
 * Safe to run multiple times (uses IF NOT EXISTS / column existence checks).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasPlacement       = await knex.schema.hasColumn('render_jobs', 'placement');
  const hasPlatform        = await knex.schema.hasColumn('render_jobs', 'platform');
  const hasPlatformExports = await knex.schema.hasColumn('render_jobs', 'platform_exports');
  const hasAdDuration      = await knex.schema.hasColumn('render_jobs', 'ad_duration_sec');
  const hasHookType        = await knex.schema.hasColumn('render_jobs', 'hook_type');
  const hasCtaText         = await knex.schema.hasColumn('render_jobs', 'cta_text');

  await knex.schema.alterTable('render_jobs', (t) => {
    if (!hasPlacement)       t.string('placement').nullable();       // 'youtube_instream' | 'tiktok_feed' | …
    if (!hasPlatform)        t.string('platform').nullable();        // 'youtube' | 'tiktok' | 'facebook' | 'instagram'
    if (!hasPlatformExports) t.jsonb('platform_exports').nullable(); // { 'youtube_instream': 'https://cdn/…', … }
    if (!hasAdDuration)      t.integer('ad_duration_sec').nullable();
    if (!hasHookType)        t.string('hook_type').nullable();
    if (!hasCtaText)         t.string('cta_text', 500).nullable();
  });

  // Index to query renders by platform
  const hasIndex = await knex.raw(`
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'render_jobs' AND indexname = 'idx_render_jobs_platform'
  `);
  if (!hasIndex.rows.length) {
    await knex.raw('CREATE INDEX idx_render_jobs_platform ON render_jobs(platform) WHERE platform IS NOT NULL');
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('render_jobs', (t) => {
    t.dropColumn('placement');
    t.dropColumn('platform');
    t.dropColumn('platform_exports');
    t.dropColumn('ad_duration_sec');
    t.dropColumn('hook_type');
    t.dropColumn('cta_text');
  });
  await knex.raw('DROP INDEX IF EXISTS idx_render_jobs_platform');
}
