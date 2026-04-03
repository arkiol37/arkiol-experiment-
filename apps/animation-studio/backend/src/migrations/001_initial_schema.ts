import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable UUID extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // ── USERS ─────────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('email').unique().notNullable();
    t.string('email_verified_at');
    t.string('password_hash').nullable();
    t.string('first_name').notNullable();
    t.string('last_name').notNullable();
    t.string('avatar_url');
    t.string('company');
    t.enum('role', ['user', 'admin', 'super_admin']).defaultTo('user');
    t.enum('status', ['active', 'suspended', 'deleted']).defaultTo('active');
    t.string('google_id').unique().nullable();
    t.string('google_access_token').nullable();
    t.timestamp('last_login_at');
    t.string('timezone').defaultTo('UTC');
    t.jsonb('metadata').defaultTo('{}');
    t.timestamps(true, true);
  });

  // ── REFRESH TOKENS ────────────────────────────────────────────
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash').notNullable().unique();
    t.string('device_info');
    t.string('ip_address');
    t.timestamp('expires_at').notNullable();
    t.boolean('revoked').defaultTo(false);
    t.timestamps(true, true);
  });

  // ── EMAIL VERIFICATION TOKENS ─────────────────────────────────
  await knex.schema.createTable('email_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash').notNullable().unique();
    t.enum('type', ['verify_email', 'reset_password']).notNullable();
    t.timestamp('expires_at').notNullable();
    t.boolean('used').defaultTo(false);
    t.timestamps(true, true);
  });

  // ── WORKSPACES / ORGANIZATIONS ────────────────────────────────
  await knex.schema.createTable('workspaces', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name').notNullable();
    t.string('slug').unique().notNullable();
    t.uuid('owner_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    t.enum('plan', ['free', 'creator', 'pro', 'studio']).defaultTo('free');  // canonical launch plans
    t.string('stripe_customer_id').unique().nullable();
    t.string('stripe_subscription_id').unique().nullable();
    t.enum('subscription_status', ['active', 'trialing', 'past_due', 'canceled', 'unpaid']).nullable();
    t.timestamp('subscription_ends_at').nullable();
    t.integer('credits_balance').defaultTo(0);
    t.integer('credits_used_this_period').defaultTo(0);
    t.timestamp('credits_reset_at').nullable();
    t.integer('storage_used_bytes').defaultTo(0);
    t.integer('storage_limit_bytes').defaultTo(5368709120); // 5GB default
    t.jsonb('settings').defaultTo('{}');
    t.jsonb('metadata').defaultTo('{}');
    t.timestamps(true, true);
  });

  // ── WORKSPACE MEMBERS ─────────────────────────────────────────
  await knex.schema.createTable('workspace_members', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.enum('role', ['owner', 'admin', 'editor', 'viewer']).defaultTo('editor');
    t.timestamp('joined_at').defaultTo(knex.fn.now());
    t.unique(['workspace_id', 'user_id']);
    t.timestamps(true, true);
  });

  // ── BRANDS ────────────────────────────────────────────────────
  await knex.schema.createTable('brands', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('industry');
    t.string('website');
    t.jsonb('colors').defaultTo('[]'); // [{hex, name, primary}]
    t.jsonb('fonts').defaultTo('[]');  // [{name, url, weight}]
    t.string('logo_asset_id').nullable();
    t.string('tagline');
    t.string('voice_tone');
    t.jsonb('style_guide').defaultTo('{}');
    t.jsonb('ai_context').defaultTo('{}'); // AI-generated brand profile
    t.timestamps(true, true);
  });

  // ── ASSETS ────────────────────────────────────────────────────
  await knex.schema.createTable('assets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.uuid('uploaded_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    t.uuid('brand_id').references('id').inTable('brands').onDelete('SET NULL').nullable();
    t.string('name').notNullable();
    t.string('original_name').notNullable();
    t.enum('type', ['logo', 'product', 'pattern', 'reference', 'video', 'audio', 'other']).notNullable();
    t.string('mime_type').notNullable();
    t.integer('size_bytes').notNullable();
    t.integer('width').nullable();
    t.integer('height').nullable();
    t.string('duration_seconds').nullable(); // for video/audio
    t.string('s3_key').notNullable().unique();
    t.string('s3_bucket').notNullable();
    t.string('cdn_url').nullable();
    t.string('thumbnail_url').nullable();
    t.jsonb('ai_analysis').defaultTo('{}'); // colors, objects detected, etc.
    t.boolean('deleted').defaultTo(false);
    t.timestamp('deleted_at').nullable();
    t.timestamps(true, true);
  });

  // ── PROJECTS ──────────────────────────────────────────────────
  await knex.schema.createTable('projects', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.uuid('brand_id').references('id').inTable('brands').onDelete('SET NULL').nullable();
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    t.string('name').notNullable();
    t.text('brief').nullable();
    t.enum('status', ['draft', 'active', 'archived', 'deleted']).defaultTo('draft');
    t.jsonb('campaign_config').defaultTo('{}'); // mood, format, scenes count etc.
    t.jsonb('performance_metrics').defaultTo('{}');
    t.timestamps(true, true);
  });

  // ── STORYBOARDS ───────────────────────────────────────────────
  await knex.schema.createTable('storyboards', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    t.string('name').notNullable();
    t.integer('version').defaultTo(1);
    t.enum('status', ['draft', 'rendering', 'complete', 'failed']).defaultTo('draft');
    t.jsonb('config').defaultTo('{}'); // aspect_ratio, render_mode, mood, etc.
    t.integer('scene_count').defaultTo(0);
    t.integer('seconds_per_scene').defaultTo(7);
    t.string('total_duration_seconds');
    t.timestamps(true, true);
  });

  // ── SCENES ────────────────────────────────────────────────────
  await knex.schema.createTable('scenes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('storyboard_id').references('id').inTable('storyboards').onDelete('CASCADE');
    t.integer('position').notNullable(); // order in storyboard
    t.enum('role', ['hook', 'problem', 'solution', 'proof', 'cta', 'custom']).defaultTo('custom');
    t.text('prompt').notNullable();
    t.text('voiceover_script').nullable();
    t.jsonb('timing').defaultTo('{}'); // {start_ms, end_ms, subtitle_cues}
    t.jsonb('visual_config').defaultTo('{}'); // camera, motion, transitions
    t.jsonb('text_overlays').defaultTo('[]'); // [{text, position, style}]
    t.enum('status', ['pending', 'queued', 'rendering', 'complete', 'failed']).defaultTo('pending');
    t.string('video_url').nullable();
    t.string('thumbnail_url').nullable();
    t.string('render_job_id').nullable();
    t.string('provider_used').nullable();
    t.jsonb('quality_report').defaultTo('{}'); // distortion, color_drift, etc.
    t.timestamps(true, true);
  });

  // ── RENDER JOBS ───────────────────────────────────────────────
  await knex.schema.createTable('render_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.uuid('storyboard_id').references('id').inTable('storyboards').onDelete('CASCADE');
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    t.string('bull_job_id').nullable();
    t.enum('status', ['queued', 'processing', 'scene_rendering', 'mixing', 'complete', 'failed', 'dead_letter']).defaultTo('queued');
    t.integer('progress').defaultTo(0); // 0-100
    t.integer('scenes_total').notNullable();
    t.integer('scenes_complete').defaultTo(0);
    t.string('current_step').nullable();
    t.integer('retry_count').defaultTo(0);
    t.integer('max_retries').defaultTo(3);
    t.string('idempotency_key').unique().notNullable();
    t.jsonb('config').defaultTo('{}');
    t.integer('credits_charged').defaultTo(0);
    t.decimal('gpu_cost_usd', 10, 6).nullable();
    t.decimal('total_cost_usd', 10, 6).nullable();
    t.decimal('revenue_usd', 10, 6).nullable();
    t.string('provider_primary').nullable();
    t.string('provider_fallback').nullable();
    t.string('output_video_url').nullable();
    t.string('output_thumbnail_url').nullable();
    t.jsonb('output_formats').defaultTo('{}'); // {9:16: url, 1:1: url, 16:9: url}
    t.text('error_message').nullable();
    t.jsonb('error_details').defaultTo('{}');
    t.timestamp('started_at').nullable();
    t.timestamp('completed_at').nullable();
    t.timestamps(true, true);
  });

  // ── VOICE RENDERS ─────────────────────────────────────────────
  await knex.schema.createTable('voice_renders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('render_job_id').references('id').inTable('render_jobs').onDelete('CASCADE');
    t.string('voice_id').notNullable();
    t.enum('gender', ['male', 'female', 'neutral']).notNullable();
    t.string('tone').notNullable();
    t.string('accent').notNullable();
    t.string('speed');
    t.text('full_script').notNullable();
    t.string('audio_url').nullable();
    t.integer('duration_ms').nullable();
    t.jsonb('subtitle_cues').defaultTo('[]');
    t.enum('status', ['pending', 'processing', 'complete', 'failed']).defaultTo('pending');
    t.timestamps(true, true);
  });

  // ── PROVIDER CONFIGS ──────────────────────────────────────────
  await knex.schema.createTable('provider_configs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.enum('provider', ['runway', 'pika', 'sora', 'custom']).notNullable();
    t.string('api_key_encrypted').notNullable(); // AES-256 encrypted
    t.string('api_url').nullable();
    t.boolean('enabled').defaultTo(true);
    t.boolean('is_primary').defaultTo(false);
    t.boolean('auto_fallback').defaultTo(true);
    t.boolean('cost_optimize').defaultTo(false);
    t.string('webhook_url').nullable();
    t.jsonb('metadata').defaultTo('{}');
    t.timestamps(true, true);
    t.unique(['workspace_id', 'provider']);
  });

  // ── BILLING / SUBSCRIPTIONS ───────────────────────────────────
  await knex.schema.createTable('billing_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('stripe_event_id').unique().notNullable();
    t.string('stripe_object_id').nullable();
    t.string('event_type').notNullable();
    t.decimal('amount_usd', 10, 2).nullable();
    t.string('currency').defaultTo('usd');
    t.jsonb('payload').defaultTo('{}');
    t.timestamps(true, true);
  });

  // ── CREDIT TRANSACTIONS ───────────────────────────────────────
  await knex.schema.createTable('credit_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.uuid('render_job_id').references('id').inTable('render_jobs').onDelete('SET NULL').nullable();
    t.enum('type', ['credit', 'debit', 'refund', 'overage', 'bonus', 'adjustment']).notNullable();
    t.integer('amount').notNullable(); // positive = credit, negative = debit
    t.integer('balance_after').notNullable();
    t.string('description').notNullable();
    t.string('stripe_invoice_id').nullable();
    t.jsonb('metadata').defaultTo('{}');
    t.timestamps(true, true);
  });

  // ── USER PREFERENCES ──────────────────────────────────────────
  await knex.schema.createTable('user_preferences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').unique();
    t.string('default_aspect_ratio').defaultTo('9:16');
    t.string('default_render_mode').defaultTo('2D Standard');
    t.string('default_mood').defaultTo('Cinematic');
    t.string('default_voice_gender').defaultTo('Female');
    t.string('default_music_style').defaultTo('Mood-aligned');
    t.boolean('beat_sync_default').defaultTo(true);
    t.boolean('auto_watermark_removal').defaultTo(true);
    t.boolean('quality_distortion_check').defaultTo(true);
    t.boolean('quality_logo_check').defaultTo(true);
    t.boolean('quality_text_check').defaultTo(true);
    t.boolean('quality_color_check').defaultTo(false);
    t.jsonb('notification_settings').defaultTo('{"email_render_complete": true, "email_billing": true, "email_marketing": false}');
    t.jsonb('ai_learned_preferences').defaultTo('{}'); // ML-derived preferences
    t.timestamps(true, true);
  });

  // ── ANALYTICS EVENTS ──────────────────────────────────────────
  await knex.schema.createTable('analytics_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE').nullable();
    t.uuid('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    t.string('event').notNullable();
    t.string('entity_type').nullable(); // 'render', 'project', 'asset'
    t.string('entity_id').nullable();
    t.jsonb('properties').defaultTo('{}');
    t.string('ip_hash').nullable(); // hashed for privacy
    t.string('user_agent');
    t.timestamps(true, true);
  });

  // ── AUDIT LOGS ────────────────────────────────────────────────
  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').nullable();
    t.uuid('user_id').nullable();
    t.string('action').notNullable(); // e.g. 'user.login', 'render.create', 'billing.upgrade'
    t.string('resource_type').nullable();
    t.string('resource_id').nullable();
    t.jsonb('before').defaultTo('{}');
    t.jsonb('after').defaultTo('{}');
    t.string('ip_address').nullable();
    t.string('user_agent').nullable();
    t.string('request_id').nullable();
    t.boolean('success').defaultTo(true);
    t.text('error_message').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── API KEYS ──────────────────────────────────────────────────
  await knex.schema.createTable('api_keys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('workspace_id').references('id').inTable('workspaces').onDelete('CASCADE');
    t.uuid('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    t.string('name').notNullable();
    t.string('key_hash').notNullable().unique(); // SHA-256 hash of actual key
    t.string('key_prefix').notNullable(); // first 8 chars for display: 'nx_live_ab12...'
    t.jsonb('scopes').defaultTo('["render:create", "render:read"]');
    t.integer('rate_limit_per_minute').defaultTo(60);
    t.integer('requests_count').defaultTo(0);
    t.timestamp('last_used_at').nullable();
    t.timestamp('expires_at').nullable();
    t.boolean('revoked').defaultTo(false);
    t.timestamps(true, true);
  });

  // ── INDEXES ───────────────────────────────────────────────────
  await knex.raw('CREATE INDEX idx_users_email ON users(email)');
  await knex.raw('CREATE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL');
  await knex.raw('CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash)');
  await knex.raw('CREATE INDEX idx_assets_workspace ON assets(workspace_id) WHERE deleted = false');
  await knex.raw('CREATE INDEX idx_render_jobs_workspace ON render_jobs(workspace_id)');
  await knex.raw('CREATE INDEX idx_render_jobs_status ON render_jobs(status)');
  await knex.raw('CREATE INDEX idx_render_jobs_idempotency ON render_jobs(idempotency_key)');
  await knex.raw('CREATE INDEX idx_credit_tx_workspace ON credit_transactions(workspace_id)');
  await knex.raw('CREATE INDEX idx_analytics_workspace ON analytics_events(workspace_id)');
  await knex.raw('CREATE INDEX idx_audit_logs_user ON audit_logs(user_id)');
  await knex.raw('CREATE INDEX idx_audit_logs_workspace ON audit_logs(workspace_id)');
  await knex.raw('CREATE INDEX idx_scenes_storyboard ON scenes(storyboard_id, position)');
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'api_keys', 'audit_logs', 'analytics_events', 'user_preferences',
    'credit_transactions', 'billing_events', 'provider_configs', 'voice_renders',
    'render_jobs', 'scenes', 'storyboards', 'projects', 'assets', 'brands',
    'workspace_members', 'workspaces', 'email_tokens', 'refresh_tokens', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
