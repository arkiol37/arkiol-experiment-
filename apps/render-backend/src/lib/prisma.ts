// apps/render-backend/src/lib/prisma.ts
//
// Render-backend Prisma client.
//
// We deliberately re-export the SAME singleton the core app uses
// (apps/arkiol-core/src/lib/prisma.ts). That singleton:
//
//   1. Uses @prisma/adapter-pg, which routes every query through
//      the `pg` library's extended-protocol with UNNAMED prepared
//      statements — the only Prisma configuration that survives
//      Supabase / PgBouncer transaction pooling. Prisma's default
//      engine sends NAMED statements ("s0", "s1", ...) which collide
//      across pooled connections and produce the production-blocking
//      error
//          ERROR: prepared statement "s0" does not exist
//
//   2. Falls back to a standard PrismaClient with
//      `?pgbouncer=true&statement_cache_size=0` appended to
//      DATABASE_URL when adapter-pg fails to load. Both paths are
//      PgBouncer-safe.
//
//   3. Caches the instance on globalThis so we never spin up two
//      connection pools per process.
//
// Sharing the singleton between render-backend's HTTP routes and
// the inner generation pipeline (core's inlineGenerate) means every
// DB call in this process uses the same adapter and the same pool
// — no duplicate connections, no half-configured client leaking
// the s0 error.
//
// `safeTransaction` is also re-exported so render-backend handlers
// can use the same PgBouncer-aware transaction wrapper.
export { prisma, safeTransaction } from '../../../arkiol-core/src/lib/prisma';
