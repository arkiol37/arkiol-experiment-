// apps/animation-studio/backend/src/migrations/005_v12_plan_enum_update.ts
// ══════════════════════════════════════════════════════════════════════════
// ARKIOL AI v12 — Animation Studio workspace plan enum update
// ══════════════════════════════════════════════════════════════════════════
//
// Problem: The workspaces.plan Knex enum only contained the legacy plan names
// ['free', 'pro', 'scale', 'enterprise']. The canonical launch plan names are
// ['free', 'creator', 'pro', 'studio']. Attempting to set workspace.plan to
// 'creator' or 'studio' would throw a Knex/PostgreSQL enum constraint error.
//
// Fix: Alter the column to accept all plan name aliases. We use a TEXT column
// with CHECK constraint approach (more flexible than native PG ENUM) or
// directly extend the enum. Since this is SQLite-safe (Knex check), we use
// ALTER COLUMN ... TYPE with USING cast on PostgreSQL.
//
// Note: workspace.plan is used only for admin analytics (groupBy) — all
// billing enforcement uses the Prisma Org.plan field via @arkiol/shared.
// ══════════════════════════════════════════════════════════════════════════

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const dialect = knex.client.config.client as string;

  if (dialect === 'postgresql' || dialect === 'pg') {
    // PostgreSQL: convert to text to avoid enum rigidity, then add check constraint
    await knex.raw(`
      ALTER TABLE workspaces
        ALTER COLUMN plan TYPE TEXT USING plan::TEXT
    `);
    await knex.raw(`
      ALTER TABLE workspaces
        DROP CONSTRAINT IF EXISTS workspaces_plan_check
    `);
    await knex.raw(`
      ALTER TABLE workspaces
        ADD CONSTRAINT workspaces_plan_check
          CHECK (plan IN ('free','creator','pro','studio'))
    `);
  }
  // SQLite (test env): no enum type — already TEXT, no action needed
}

export async function down(knex: Knex): Promise<void> {
  // Reversing to a strict enum would lose 'creator'/'studio' data. No-op rollback.
}
