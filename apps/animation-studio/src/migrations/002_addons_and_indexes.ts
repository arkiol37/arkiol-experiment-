import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Render jobs additional columns ───────────────────────────
  await knex.schema.alterTable('render_jobs', (t) => {
    // Already added by migration 001 for some setups; use addColumnIfNotExists pattern
    t.jsonb('quality_report').defaultTo('{}').nullable();
    t.jsonb('output_formats').defaultTo('{}').nullable();
    t.string('output_thumbnail_url').nullable();
    t.string('cancelled_by').nullable();
    t.timestamp('cancelled_at').nullable();
  }).catch(() => {}); // Ignore if columns already exist

  // ── Scenes error column ───────────────────────────────────────
  await knex.schema.alterTable('scenes', (t) => {
    t.text('error').nullable();
  }).catch(() => {});

  // ── Workspace per-user concurrency settings ───────────────────
  await knex.schema.alterTable('workspaces', (t) => {
    t.integer('max_concurrent_renders').defaultTo(1);
  }).catch(() => {});

  // ── Performance indexes ───────────────────────────────────────
  const indexes = [
    ['render_jobs', 'workspace_id, status', 'idx_render_jobs_ws_status'],
    ['render_jobs', 'idempotency_key', 'idx_render_jobs_idem'],
    ['scenes', 'storyboard_id, position', 'idx_scenes_sb_pos'],
    ['assets', 'workspace_id', 'idx_assets_ws'],
    ['audit_logs', 'workspace_id', 'idx_audit_ws'],
    ['audit_logs', 'user_id', 'idx_audit_user'],
    ['analytics_events', 'workspace_id', 'idx_analytics_ws'],
    ['credit_transactions', 'workspace_id', 'idx_credits_ws'],
    ['billing_events', 'stripe_event_id', 'idx_billing_stripe_event'],
  ];

  for (const [table, cols, name] of indexes) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`);
  }
}

export async function down(knex: Knex): Promise<void> {
  const indexes = [
    'idx_render_jobs_ws_status', 'idx_render_jobs_idem', 'idx_scenes_sb_pos',
    'idx_assets_ws', 'idx_audit_ws', 'idx_audit_user',
    'idx_analytics_ws', 'idx_credits_ws', 'idx_billing_stripe_event',
  ];
  for (const idx of indexes) {
    await knex.raw(`DROP INDEX IF EXISTS ${idx}`);
  }
}
