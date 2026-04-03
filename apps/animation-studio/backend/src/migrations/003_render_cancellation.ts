import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add cancellation columns if not present (from 002 partial migration)
  const hasCol = await knex.schema.hasColumn('render_jobs', 'cancelled_at');
  if (!hasCol) {
    await knex.schema.alterTable('render_jobs', (t) => {
      t.timestamp('cancelled_at').nullable();
      t.uuid('cancelled_by').nullable();
    });
  }

  // Ensure scenes has error column
  const hasError = await knex.schema.hasColumn('scenes', 'error');
  if (!hasError) {
    await knex.schema.alterTable('scenes', (t) => {
      t.text('error').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // No-op for safety
}
