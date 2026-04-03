// src/migrations/004_v16_ai_engine_benchmarks.ts
// V16: Advanced AI Engine — Benchmark & Continuous Improvement Tables
//
// Creates all tables required for:
//   - Per-asset render quality benchmarks (ai_benchmark_records)
//   - Per-job aggregated summaries (ai_job_summaries)
//   - Rolling style performance accumulators (ai_style_performance)
//   - Rolling format performance accumulators (ai_format_performance)
//   - A/B experiment result tracking (ai_ab_results)
//   - AI feedback events (ai_feedback_events)
//   - AI-generated asset cache (ai_generated_assets)
//
// All tables are append-only for write safety.
// Rolling aggregates use upsert semantics (safe to replay).

import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // ── ai_benchmark_records (per-asset, append-only) ──────────────────────────
  await knex.schema.createTableIfNotExists("ai_benchmark_records", (t) => {
    t.string("id").primary();
    t.string("asset_id").notNullable();
    t.string("job_id").notNullable();
    t.string("org_id").notNullable();
    t.string("format").notNullable();
    t.integer("variation_idx").notNullable().defaultTo(0);
    t.string("style_preset").notNullable();
    t.string("output_format").notNullable();
    t.float("overall_score").notNullable().defaultTo(0);
    t.float("brand_alignment").notNullable().defaultTo(0);
    t.float("hierarchy_score").notNullable().defaultTo(0);
    t.float("density_score").notNullable().defaultTo(0);
    t.float("contrast_score").notNullable().defaultTo(0);
    t.integer("violation_count").notNullable().defaultTo(0);
    t.integer("pipeline_ms").notNullable().defaultTo(0);
    t.boolean("any_fallback").notNullable().defaultTo(false);
    t.string("layout_family").notNullable();
    t.jsonb("ab_variants").notNullable().defaultTo("{}");
    t.jsonb("stage_perfs").notNullable().defaultTo("[]");
    t.timestamp("rendered_at").notNullable();

    t.index(["org_id", "rendered_at"]);
    t.index(["job_id"]);
    t.index(["format", "org_id"]);
    t.index(["style_preset", "org_id"]);
  });

  // ── ai_job_summaries (per-job aggregate) ──────────────────────────────────
  await knex.schema.createTableIfNotExists("ai_job_summaries", (t) => {
    t.string("job_id").primary();
    t.string("org_id").notNullable();
    t.integer("asset_count").notNullable().defaultTo(0);
    t.float("avg_overall_score").notNullable().defaultTo(0);
    t.integer("avg_pipeline_ms").notNullable().defaultTo(0);
    t.float("avg_brand_score").notNullable().defaultTo(0);
    t.float("avg_hierarchy_score").notNullable().defaultTo(0);
    t.float("fallback_rate").notNullable().defaultTo(0);
    t.float("violation_rate").notNullable().defaultTo(0);
    t.string("worst_stage").nullable();
    t.jsonb("ab_variants").notNullable().defaultTo("{}");
    t.timestamp("completed_at").notNullable();

    t.index(["org_id", "completed_at"]);
  });

  // ── ai_style_performance (rolling aggregate per org × style) ──────────────
  await knex.schema.createTableIfNotExists("ai_style_performance", (t) => {
    t.string("id").primary();
    t.string("org_id").notNullable();
    t.string("style_preset").notNullable();
    t.integer("sample_count").notNullable().defaultTo(0);
    t.float("avg_quality_score").notNullable().defaultTo(0);
    t.float("avg_pipeline_ms").notNullable().defaultTo(0);
    t.float("avg_violations").notNullable().defaultTo(0);
    t.string("trend").notNullable().defaultTo("insufficient_data");
    t.timestamp("last_updated").notNullable().defaultTo(knex.fn.now());

    t.unique(["org_id", "style_preset"]);
    t.index(["org_id"]);
  });

  // ── ai_format_performance (rolling aggregate per org × format) ────────────
  await knex.schema.createTableIfNotExists("ai_format_performance", (t) => {
    t.string("id").primary();
    t.string("org_id").notNullable();
    t.string("format").notNullable();
    t.integer("sample_count").notNullable().defaultTo(0);
    t.float("avg_quality_score").notNullable().defaultTo(0);
    t.float("fallback_rate").notNullable().defaultTo(0);
    t.string("top_layout_family").nullable();
    t.timestamp("last_updated").notNullable().defaultTo(knex.fn.now());

    t.unique(["org_id", "format"]);
    t.index(["org_id"]);
  });

  // ── ai_ab_results (A/B experiment results per org × experiment × variant) ──
  await knex.schema.createTableIfNotExists("ai_ab_results", (t) => {
    t.string("id").primary();
    t.string("org_id").notNullable();
    t.string("experiment_name").notNullable();
    t.string("variant").notNullable();
    t.integer("sample_count").notNullable().defaultTo(0);
    t.float("avg_quality_score").notNullable().defaultTo(0);
    t.float("avg_pipeline_ms").notNullable().defaultTo(0);
    t.timestamp("last_updated").notNullable().defaultTo(knex.fn.now());

    t.unique(["org_id", "experiment_name", "variant"]);
    t.index(["org_id", "experiment_name"]);
  });

  // ── ai_feedback_events (fire-and-forget from generation worker) ───────────
  await knex.schema.createTableIfNotExists("ai_feedback_events", (t) => {
    t.string("id").primary();
    t.string("org_id").notNullable();
    t.string("session_id").notNullable();
    t.string("job_id").nullable();
    t.string("asset_id").nullable();
    t.string("event_type").notNullable();
    t.string("format").nullable();
    t.string("plan_key").nullable();
    t.integer("variation_idx").nullable();
    t.integer("duration_ms").nullable();
    t.float("quality_score").nullable();
    t.jsonb("metadata").notNullable().defaultTo("{}");
    t.timestamp("occurred_at").notNullable().defaultTo(knex.fn.now());

    t.index(["org_id", "occurred_at"]);
    t.index(["job_id"]);
    t.index(["event_type"]);
  });

  // ── ai_generated_assets (similarity cache) ────────────────────────────────
  await knex.schema.createTableIfNotExists("ai_generated_assets", (t) => {
    t.string("id").primary();
    t.string("org_id").notNullable();
    t.string("asset_type").notNullable();
    t.string("quality").notNullable();
    t.string("source").notNullable();
    t.text("url").notNullable();
    t.text("cdn_url").nullable();
    t.integer("width").notNullable();
    t.integer("height").notNullable();
    t.string("mime_type").notNullable();
    t.text("mask_url").nullable();
    t.jsonb("palette").notNullable().defaultTo("[]");
    t.boolean("perspective_fit").notNullable().defaultTo(false);
    t.boolean("safety_validated").notNullable().defaultTo(false);
    t.string("similarity_hash").nullable();
    t.text("prompt_used").nullable();
    t.jsonb("metadata").notNullable().defaultTo("{}");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["org_id", "similarity_hash"]);
    t.index(["org_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("ai_generated_assets");
  await knex.schema.dropTableIfExists("ai_feedback_events");
  await knex.schema.dropTableIfExists("ai_ab_results");
  await knex.schema.dropTableIfExists("ai_format_performance");
  await knex.schema.dropTableIfExists("ai_style_performance");
  await knex.schema.dropTableIfExists("ai_job_summaries");
  await knex.schema.dropTableIfExists("ai_benchmark_records");
}
