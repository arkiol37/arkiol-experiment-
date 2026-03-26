/**
 * Migration 007 — Brand Asset Library
 *
 * Adds the complete Brand Asset Library infrastructure:
 *   brand_assets              — User-uploaded brand materials (logos, products, screenshots, packaging)
 *   brand_asset_processing_jobs — AI processing queue per asset
 *   brand_asset_palette       — Extracted color palettes per asset
 *   render_jobs.brand_asset_ids — Foreign-key linkage from render jobs to brand assets
 *
 * Processing pipeline stages tracked:
 *   1. background_removal
 *   2. subject_isolation
 *   3. color_extraction
 *   4. classification
 *   5. vectorization (optional, may fail gracefully)
 *   6. style_normalization
 *   7. enhancement
 *
 * Safe to run multiple times (uses IF NOT EXISTS / column existence checks).
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── brand_assets ────────────────────────────────────────────────────────────
  await knex.schema.createTableIfNotExists('brand_assets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE').notNullable();
    t.uuid('brand_id').references('id').inTable('brands').onDelete('SET NULL').nullable();
    t.uuid('uploaded_by').references('id').inTable('users').onDelete('SET NULL').nullable();

    // ── Upload metadata ──────────────────────────────────────────────────────
    t.string('name').notNullable();
    t.string('original_name').notNullable();
    t.string('mime_type').notNullable();
    t.integer('size_bytes').notNullable();
    t.integer('width').nullable();
    t.integer('height').nullable();
    t.string('s3_key').notNullable();
    t.string('s3_bucket').notNullable();
    t.string('cdn_url').nullable();
    t.string('thumbnail_url').nullable();

    // ── AI Classification ────────────────────────────────────────────────────
    // logo | product | screenshot | packaging | pattern | icon | other
    t.string('asset_type').notNullable().defaultTo('other');
    // Primary usage role inferred from type
    // logo_slot | product_slot | screenshot_slot | brand_reveal_slot | background_slot
    t.string('usage_role').nullable();
    // User can override the auto-assigned role
    t.string('user_role_override').nullable();
    // Confidence score [0-1] for auto-classification
    t.float('classification_confidence').defaultTo(0);
    // Rich AI analysis metadata
    t.jsonb('ai_analysis').defaultTo('{}');

    // ── Processing Pipeline ──────────────────────────────────────────────────
    // pending | processing | ready | failed
    t.string('processing_status').notNullable().defaultTo('pending');
    t.timestamp('processing_started_at').nullable();
    t.timestamp('processing_completed_at').nullable();
    t.integer('processing_attempts').defaultTo(0);
    t.text('processing_error').nullable();
    // Stage-level results
    t.jsonb('pipeline_stages').defaultTo('{}');

    // ── Processed Asset Variants ─────────────────────────────────────────────
    // Background-removed / cutout PNG
    t.string('cutout_s3_key').nullable();
    t.string('cutout_cdn_url').nullable();
    // Vectorized SVG (optional, may remain null if vectorization fails)
    t.string('vector_s3_key').nullable();
    t.string('vector_cdn_url').nullable();
    // Stylized/flat-2D version
    t.string('stylized_s3_key').nullable();
    t.string('stylized_cdn_url').nullable();
    // Enhanced (color-normalized, contrast-boosted) version
    t.string('enhanced_s3_key').nullable();
    t.string('enhanced_cdn_url').nullable();

    // ── Brand Colors Extracted ───────────────────────────────────────────────
    // Array of hex strings, up to 8 dominant colors
    t.jsonb('extracted_palette').defaultTo('[]');
    // Primary brand color extracted (hex)
    t.string('primary_color').nullable();
    // Has transparency / alpha channel
    t.boolean('has_alpha').defaultTo(false);
    // Subject bounding box in original image [x, y, w, h] normalized 0-1
    t.jsonb('subject_bbox').nullable();

    // ── Motion / Animation Intelligence ─────────────────────────────────────
    // Recommended animation style: float | spin | scale_in | slide_in | parallax | reveal | none
    t.string('recommended_motion').nullable();
    // Recommended transition: cut | crossfade | zoom | push | morph
    t.string('recommended_transition').nullable();
    // Placement hints for scene building
    t.jsonb('scene_placement_hints').defaultTo('{}');

    // ── Soft delete ──────────────────────────────────────────────────────────
    t.timestamp('deleted_at').nullable();
    t.uuid('deleted_by').nullable();

    t.timestamps(true, true);
  });

  // Indexes for brand_assets
  await knex.schema.table('brand_assets', (t) => {
    t.index('workspace_id');
    t.index('brand_id');
    t.index('asset_type');
    t.index('processing_status');
    t.index('deleted_at');
  });

  // ── brand_asset_processing_jobs ─────────────────────────────────────────────
  await knex.schema.createTableIfNotExists('brand_asset_processing_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('brand_asset_id').references('id').inTable('brand_assets').onDelete('CASCADE').notNullable();
    t.uuid('workspace_id').notNullable();
    // Stage name
    t.string('stage').notNullable();
    // queued | running | done | failed | skipped
    t.string('status').notNullable().defaultTo('queued');
    t.integer('attempt').defaultTo(0);
    t.integer('max_attempts').defaultTo(3);
    t.jsonb('input_params').defaultTo('{}');
    t.jsonb('output').defaultTo('{}');
    t.text('error').nullable();
    t.integer('duration_ms').nullable();
    t.timestamp('started_at').nullable();
    t.timestamp('completed_at').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.table('brand_asset_processing_jobs', (t) => {
    t.index('brand_asset_id');
    t.index(['workspace_id', 'status']);
  });

  // ── Link brand assets to render_jobs ────────────────────────────────────────
  const hasBrandAssetIds = await knex.schema.hasColumn('render_jobs', 'brand_asset_ids');
  const hasBrandPalette  = await knex.schema.hasColumn('render_jobs', 'brand_palette');
  const hasAssetSlots    = await knex.schema.hasColumn('render_jobs', 'asset_slots');

  await knex.schema.alterTable('render_jobs', (t) => {
    // Array of brand_asset UUIDs used in this render
    if (!hasBrandAssetIds) t.specificType('brand_asset_ids', 'uuid[]').nullable();
    // Brand palette extracted from uploaded assets (overrides default palette)
    if (!hasBrandPalette)  t.jsonb('brand_palette').nullable();
    // Scene slot → asset mapping: { hook_product: 'uuid', cta_logo: 'uuid', ... }
    if (!hasAssetSlots)    t.jsonb('asset_slots').nullable();
  });

  // ── Prisma shared schema: BrandUploadedAsset table (for arkiol-core) ────────
  // NOTE: These columns are added to the shared `assets` table so arkiol-core
  // can also query brand assets via Prisma. The animation-studio reads brand_assets directly.
  const sharedHasAssetType = await knex.schema.hasColumn('assets', 'brand_asset_type').catch(() => false);
  if (!sharedHasAssetType) {
    const assetsExists = await knex.schema.hasTable('assets');
    if (assetsExists) {
      await knex.schema.alterTable('assets', (t) => {
        t.string('brand_asset_type').nullable();
        t.string('brand_cutout_url').nullable();
        t.jsonb('brand_palette').nullable();
        t.string('brand_processing_status').defaultTo('pending').nullable();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('brand_asset_processing_jobs');
  await knex.schema.dropTableIfExists('brand_assets');

  await knex.schema.alterTable('render_jobs', (t) => {
    t.dropColumn('brand_asset_ids');
    t.dropColumn('brand_palette');
    t.dropColumn('asset_slots');
  });
}
