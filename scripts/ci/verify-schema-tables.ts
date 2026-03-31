#!/usr/bin/env tsx
/**
 * scripts/ci/verify-schema-tables.ts
 *
 * Called by the migration-check CI job after prisma migrate deploy.
 * Confirms that every table defined in the unified schema actually exists
 * in the database. Exits non-zero if any table is missing.
 */

import { Client } from 'pg';

// Every Prisma model in packages/shared/prisma/schema.prisma maps to one of
// these table names (Prisma lowercases + snake_cases CamelCase model names).
// Table names match the Prisma model names exactly (PascalCase), except where
// @map overrides are used (ExplorationRun, ExplorationCandidate, etc. use snake_case @map).
// Both forms are checked by the snaked fallback below.
const REQUIRED_TABLES = [
  // Core platform
  'Org', 'User', 'Account', 'Session', 'VerificationToken',
  // Jobs & assets
  'Job', 'Asset', 'AIGeneratedAsset',
  // Credits & billing
  'CreditTransaction', 'CreditPack', 'BillingEvent',
  // Brands & campaigns
  'Brand', 'Campaign', 'EditorDraft',
  // Studio
  'StudioProject', 'ContentPack',
  // API & webhooks
  'ApiKey', 'Webhook',            // model is Webhook (not WebhookEndpoint — fixed v12)
  // Audit & usage
  'AuditLog', 'Usage',            // model is Usage (not UsageRecord — fixed v12)
  // AI feedback & alerts
  'AIFeedbackEvent', 'AlertLog',
  // AI benchmarking
  'AIBenchmarkRecord', 'AIJobSummary', 'AIStylePerformance',
  'AIFormatPerformance', 'AIABResult', 'AIJobMetadata', 'AIStageTrace',
  // Exploration engine (stored as snake_case via @map — snaked fallback handles these)
  'ExplorationRun', 'ExplorationCandidate', 'ExplorationFeedback',
  'ExplorationPrior', 'ExplorationNoveltyArchive',
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  // Fetch all existing table names from the public schema
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  await client.end();

  const existing = new Set(rows.map(r => r.tablename));

  // Prisma stores table names as the exact model name (PascalCase) by default
  // unless @map is used. Check both forms.
  const missing: string[] = [];
  for (const model of REQUIRED_TABLES) {
    // Prisma default: model name used as table name
    const snaked = model.replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l.toLowerCase() : '_' + l.toLowerCase()));
    if (!existing.has(model) && !existing.has(snaked)) {
      missing.push(model);
    }
  }

  if (missing.length === 0) {
    console.log(`✓ All ${REQUIRED_TABLES.length} required tables confirmed in database`);
    process.exit(0);
  } else {
    console.error(`✗ ${missing.length} required table(s) missing after migration:`);
    missing.forEach(t => console.error(`    - ${t}`));
    console.error('\nExisting tables:', [...existing].sort().join(', '));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('verify-schema-tables: unexpected error:', err.message);
  process.exit(1);
});
