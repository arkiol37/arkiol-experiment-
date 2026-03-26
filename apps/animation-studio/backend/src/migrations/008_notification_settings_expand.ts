import type { Knex } from 'knex';

// Migration 008 — Expand notification_settings JSON defaults in user_preferences
// Adds: email_render_failed, email_low_credits, email_weekly_digest, email_product_updates
// Backfills existing rows that are missing the new keys.

export async function up(knex: Knex): Promise<void> {
  // For PostgreSQL: use jsonb_set to add missing keys without overwriting existing values
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  if (isPostgres) {
    // Backfill missing keys for each existing row using jsonb || (merge) operator
    await knex.raw(`
      UPDATE user_preferences
      SET notification_settings = '{
        "email_render_complete":  true,
        "email_render_failed":    true,
        "email_billing":          true,
        "email_low_credits":      true,
        "email_weekly_digest":    false,
        "email_marketing":        false,
        "email_product_updates":  true
      }'::jsonb || notification_settings
      WHERE notification_settings IS NOT NULL
    `);
  } else {
    // SQLite fallback: update all rows with a complete merged object
    const rows = await knex('user_preferences').select('user_id', 'notification_settings');
    for (const row of rows) {
      const existing = typeof row.notification_settings === 'string'
        ? JSON.parse(row.notification_settings)
        : (row.notification_settings ?? {});

      const merged = {
        email_render_complete:  true,
        email_render_failed:    true,
        email_billing:          true,
        email_low_credits:      true,
        email_weekly_digest:    false,
        email_marketing:        false,
        email_product_updates:  true,
        ...existing, // preserve any user overrides
      };

      await knex('user_preferences')
        .where({ user_id: row.user_id })
        .update({ notification_settings: JSON.stringify(merged) });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Non-destructive — no meaningful rollback needed for a JSON key expansion
}
