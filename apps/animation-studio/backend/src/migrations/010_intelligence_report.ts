/**
 * Migration 010: Add intelligence_report column to render_jobs
 * Stores candidate pipeline metadata (comparison insights, progressive feedback,
 * perception signals, scoring) for frontend consumption.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('render_jobs', (table) => {
    table.jsonb('intelligence_report').nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('render_jobs', (table) => {
    table.dropColumn('intelligence_report');
  });
}
