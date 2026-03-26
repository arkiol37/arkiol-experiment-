# ARKIOL v3 — Prisma Schema: Single Source of Truth

## The Rule

**`packages/shared/prisma/schema.prisma`** is the **one and only** authoritative
Prisma schema for the entire ARKIOL platform. This is not a convention —
it is enforced by every script, every CI step, and every build command.

## What lives where

```
packages/
  shared/
    prisma/
      schema.prisma          ← THE ONLY REAL SCHEMA. Edit here.
      migrations/            ← THE ONLY MIGRATION HISTORY. All 9 migrations.
        20260227_unified_platform/
        20260228_hardening/
        20260228_v16/
        20260301_ai_engine_benchmarks/
        20260301_brand_learning_flag/
        20260302_asset_engine_v2/
        20260303_archetype_intelligence/
        20260305_v9_platform/
        20260306_v10_consolidation/   ← Final consolidation (v10 unification)

apps/
  arkiol-core/
    prisma/
      schema.prisma          ← INERT STUB. No valid Prisma syntax. For IDE only.
      seed.ts                ← Seed script (reads shared schema via client)
```

## Correct commands — always pass `--schema`

Every Prisma command must reference the shared schema explicitly:

```bash
# Generate Prisma client
prisma generate --schema=packages/shared/prisma/schema.prisma

# Create a new migration (development)
prisma migrate dev --schema=packages/shared/prisma/schema.prisma

# Apply migrations (production / CI)
prisma migrate deploy --schema=packages/shared/prisma/schema.prisma

# Inspect database
prisma studio --schema=packages/shared/prisma/schema.prisma

# Push schema without migration (prototyping only)
prisma db push --schema=packages/shared/prisma/schema.prisma
```

## Use workspace scripts (recommended)

The root `package.json` provides scripts that include the correct `--schema` flag:

```bash
npm run db:generate    # prisma generate --schema=packages/shared/...
npm run db:migrate     # prisma migrate dev --schema=packages/shared/...
npm run db:deploy      # prisma migrate deploy --schema=packages/shared/...
npm run db:studio      # prisma studio --schema=packages/shared/...
npm run db:seed        # tsx apps/arkiol-core/prisma/seed.ts
```

And from within `apps/arkiol-core`:

```bash
npm run build          # prisma generate (shared schema) && next build
npm run db:migrate     # prisma migrate dev (shared schema)
npm run db:deploy      # prisma migrate deploy (shared schema)
```

## Do NOT do this

```bash
# WRONG — no --schema flag; Prisma searches upward and may find the inert stub
# or no schema at all. Always specify --schema explicitly.
prisma generate
prisma migrate dev

# WRONG — this file is intentionally inert (no valid Prisma syntax).
# The CLI will fail with a parse error or "no datasource" error.
prisma generate --schema=apps/arkiol-core/prisma/schema.prisma
prisma migrate dev --schema=apps/arkiol-core/prisma/schema.prisma
prisma db push --schema=apps/arkiol-core/prisma/schema.prisma
```

## The inert IDE stub

`apps/arkiol-core/prisma/schema.prisma` is a **fully inert comment-only file**. It contains:

- **No `datasource` block** — the Prisma CLI cannot connect to any database from this file
- **No `generator` block** — `prisma generate` cannot run against this file
- **No model definitions** — no schema drift is possible from this file
- **No valid Prisma syntax of any kind** — only comments

The file exists so that the Prisma VS Code extension finds *something* in the
`apps/arkiol-core` directory tree and does not show a "schema not found" warning.
The extension treats a comment-only file as an empty schema and shows no errors.

## Why one schema?

Both the Arkiol Core app (Next.js) and the Animation Studio (Express) share
**one PostgreSQL database**. Before v10, each app maintained its own schema,
causing:

- Type mismatches when the Prisma client was generated from the wrong schema
- Migration drift between the two histories
- Duplicate model definitions with diverging fields
- Silent failures when one app's migrations hadn't been run

The v10 consolidation (`20260306_v10_consolidation`) resolved all drift and
established the shared schema as the permanent single source of truth.

## Adding new models or fields

1. Edit **only** `packages/shared/prisma/schema.prisma`
2. Run `npm run db:migrate` from the repo root to generate a migration
3. Commit both the updated schema and the new migration folder
4. In CI/production, `npm run db:deploy` applies the migration

Never edit `apps/arkiol-core/prisma/schema.prisma` (the stub) — it is not read
by Prisma during any operation other than IDE tooling.
