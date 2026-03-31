[DEVELOPMENT.md](https://github.com/user-attachments/files/26391672/DEVELOPMENT.md)
# Local Development

## Prerequisites

- Node.js >= 20 (see `.nvmrc`)
- npm >= 10
- PostgreSQL (local or Supabase free tier)
- Redis (local `redis-server` or Upstash free tier)
- A committed `package-lock.json` (see DEPLOY.md Step 1 if missing)

## First-time setup

```bash
# Validate repo, install deps, build, type-check, and test
bash scripts/bootstrap.sh

# Configure environment
cp apps/arkiol-core/.env.example apps/arkiol-core/.env.local
# Edit .env.local — minimum: DATABASE_URL, NEXTAUTH_SECRET, FOUNDER_EMAIL

# Set up database
npm run db:deploy    # applies all migrations
npm run db:seed      # creates dev fixtures (requires ALLOW_SEED=development)
```

## Running locally

```bash
# Core platform (Next.js on port 3000)
npm run dev

# Animation Studio (Express on :4000, Vite on :5173)
npm run dev:studio

# Both simultaneously
npm run dev:all

# Workers (for queue processing — needs Redis)
npm run worker:core
```

## Workspace structure

All workspaces are managed from the monorepo root:

```bash
npm run <script> --workspace=apps/arkiol-core
npm run <script> --workspace=packages/shared
npm run <script> --workspace=apps/animation-studio/backend
```

## Database

The single Prisma schema lives at `packages/shared/prisma/schema.prisma`. All migration and generate commands must reference it:

```bash
npm run db:generate   # Generate Prisma client
npm run db:migrate    # Create new migration (dev)
npm run db:deploy     # Apply migrations (prod)
npm run db:studio     # Visual database browser
```

Never create a second schema file. The stub at `apps/arkiol-core/prisma/` is for IDE tooling only.

## Testing

```bash
npm test                    # All workspaces
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:coverage       # With coverage report
```

Jest config: `apps/arkiol-core/jest.config.ts`. Module aliases (`@/`, `@arkiol/shared`, `server-only`) are mapped there.

## Building

```bash
npm run build       # shared + core
npm run build:all   # shared + core + animation-studio backend
```

The Next.js build runs `prisma generate` automatically via the `vercel-build` script.

## Code organization

- **`packages/shared/src/`** — Business logic shared across apps: plans, credits, billing, capabilities, schemas
- **`apps/arkiol-core/src/engines/`** — Pure TypeScript AI/design engines (no external API calls)
- **`apps/arkiol-core/src/app/api/`** — Next.js API routes
- **`apps/arkiol-core/src/workers/`** — BullMQ queue workers (deployed separately from Vercel)
- **`apps/arkiol-core/src/lib/`** — Auth, database, queue, utilities

## Troubleshooting

**`prisma generate` fails**: Run from monorepo root: `npx prisma generate --schema=packages/shared/prisma/schema.prisma`

**Type errors after schema change**: Regenerate Prisma client, then restart TS server in your editor.

**`npm ci` fails**: The lockfile must exist and match `package.json`. If dependencies changed, run `npm install --legacy-peer-deps` to update the lockfile, then commit both `package.json` and `package-lock.json`.

**Edge Runtime errors in middleware**: `src/middleware.ts` cannot import `@arkiol/shared` — it runs in Edge Runtime. See the comments in that file.
