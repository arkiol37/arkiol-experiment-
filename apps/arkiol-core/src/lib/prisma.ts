// src/lib/prisma.ts
// ─────────────────────────────────────────────────────────────────────────────
// Supabase PgBouncer-compatible Prisma client via @prisma/adapter-pg
// ─────────────────────────────────────────────────────────────────────────────
//
// PROBLEM: Prisma's default query engine sends EVERY query as a PostgreSQL
// named prepared statement ("s0", "s1", "s2", …). Supabase PgBouncer runs in
// transaction-pooling mode, which recycles connections between requests. When
// Request B gets a connection that Request A already used, PostgreSQL still
// has "s0" registered → "prepared statement s0 already exists" crash.
//
// This affects ALL queries: findUnique, update, create — not just transactions.
//
// SOLUTION: @prisma/adapter-pg replaces Prisma's built-in query engine with
// the `pg` library. The `pg` library uses the extended query protocol with
// UNNAMED prepared statements (empty string name), which PgBouncer handles
// correctly because unnamed statements are automatically cleaned up.
//
// When `adapter` is passed to PrismaClient, Prisma delegates ALL SQL
// execution to the adapter. The built-in engine is completely bypassed.
// Every prisma.user.findUnique(), prisma.job.create(), etc. goes through pg.
//
// CONNECTION ROUTING:
//   DATABASE_URL (pooled, port 6543) → runtime queries via pg Pool
//   DIRECT_URL  (direct, port 5432) → Prisma CLI migrations/introspection
// ─────────────────────────────────────────────────────────────────────────────
import { detectCapabilities, bootstrapEnv } from '@arkiol/shared';

const nodeEnv = bootstrapEnv('NODE_ENV');

let _prisma: any = null;

function createPrismaClient() {
  const { PrismaClient } = require('@prisma/client');

  // ── Try driver adapter (required for Supabase PgBouncer) ────────────────
  try {
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { Pool } = require('pg');

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }

    const pool = new Pool({
      connectionString,
      // Vercel serverless: functions are short-lived, keep pool small
      max: 5,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 10000,
    });

    const adapter = new PrismaPg(pool);

    const client = new PrismaClient({
      adapter,
      log: nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    console.info('[prisma] Initialized with @prisma/adapter-pg (PgBouncer-safe)');
    return client;

  } catch (adapterErr: any) {
    // ── Adapter failed — DO NOT silently fall back to standard client ──────
    // The standard PrismaClient WILL crash with "prepared statement s0 already
    // exists" on Supabase. Falling back silently would mask the problem.
    //
    // Instead, log the real error loudly, then try the standard client WITH
    // pgbouncer=true appended to DATABASE_URL as a last resort. This param
    // tells Prisma's built-in engine to avoid prepared statements.
    console.error(
      '[prisma] CRITICAL: @prisma/adapter-pg failed to initialize.',
      'This WILL cause "prepared statement already exists" errors on Supabase.',
      'Error:', adapterErr?.message
    );

    // Last resort: modify DATABASE_URL to include pgbouncer=true
    // This tells Prisma's built-in engine to disable prepared statements
    let url = process.env.DATABASE_URL ?? '';
    if (url && !url.includes('pgbouncer=true')) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}pgbouncer=true&statement_cache_size=0`;
    }

    const client = new PrismaClient({
      datasourceUrl: url,
      log: ['error', 'warn'],
    });

    console.warn('[prisma] Falling back to standard PrismaClient with pgbouncer=true param');
    return client;
  }
}

const globalForPrisma = globalThis as any;

// Stub for when DATABASE_URL is absent — rejects with clear error
const DB_NOT_CONFIGURED = new Proxy(
  (() => Promise.reject(new Error('Database not configured. Add DATABASE_URL.'))) as any,
  { get: () => DB_NOT_CONFIGURED }
);

export const prisma: any = new Proxy({} as any, {
  get(_target, prop) {
    if (!_prisma) {
      if (!detectCapabilities().database) {
        return DB_NOT_CONFIGURED;
      }
      _prisma = globalForPrisma.prisma ?? createPrismaClient();
      if (_prisma && nodeEnv !== 'production') {
        globalForPrisma.prisma = _prisma;
      }
    }
    return _prisma ? (_prisma as any)[prop] : DB_NOT_CONFIGURED;
  },
});

// ── PgBouncer-safe interactive transaction wrapper ────────────────────────
//
// With the pg adapter, interactive $transaction generally works because pg
// uses unnamed prepared statements. This wrapper is a safety net for any
// remaining edge cases where PgBouncer rejects multi-statement transactions.
//
const PGBOUNCER_ERROR_PATTERNS = [
  'interactive transaction',
  'prepared statement',
  'Transaction API error',
  'P2028',
  'DISCARD ALL',
  'already exists',
];

function isPgBouncerError(err: any): boolean {
  const msg = String(err?.message ?? '') + String(err?.code ?? '');
  return PGBOUNCER_ERROR_PATTERNS.some(p => msg.includes(p));
}

export async function safeTransaction<T>(
  fn: (tx: any) => Promise<T>,
  options?: { timeout?: number }
): Promise<T> {
  try {
    return await prisma.$transaction(fn, {
      timeout: options?.timeout ?? 15000,
    });
  } catch (err: any) {
    if (isPgBouncerError(err)) {
      console.warn('[prisma] Transaction failed (PgBouncer), sequential fallback');
      return fn(prisma);
    }
    throw err;
  }
}
