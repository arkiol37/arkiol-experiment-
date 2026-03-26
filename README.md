# ARKIOL v3

> One subscription. One credit economy. Design + Animation Studio.

ARKIOL is a production-grade AI-powered design and animation SaaS platform built as a monorepo. It combines a Next.js design studio (arkiol-core) with a full animation pipeline (animation-studio), sharing a single PostgreSQL database, credit ledger, and billing layer through the `@arkiol/shared` package.

---

## Architecture

```
arkiol/                               ← monorepo root
├── apps/
│   ├── arkiol-core/                  ← Design SaaS (Next.js 14)
│   └── animation-studio/             ← Animation Studio (Express + React)
│       ├── backend/                  ← Express API + BullMQ workers
│       └── frontend/                 ← React SPA
└── packages/
    └── shared/                       ← Platform layer (shared by both apps)
        ├── prisma/
        │   └── schema.prisma         ← SINGLE authoritative schema
        └── src/
            ├── plans.ts              ← Plan configs + credit costs
            ├── credits.ts            ← Append-only credit ledger
            ├── planEnforcer.ts       ← Backend feature-flag enforcement
            ├── jobLifecycle.ts       ← Atomic enqueue/fail/refund
            ├── stripeWebhooks.ts     ← Idempotent Stripe event handler
            ├── monitoring.ts         ← Alert system (cost, volume, stage health)
            ├── webhookSsrfGuard.ts   ← SSRF protection for webhook endpoints
            └── index.ts              ← Public barrel export
```

## Module Boundaries

| Rule | Detail |
|------|--------|
| No cross-app imports | arkiol-core and animation-studio never import from each other |
| Shared layer only | All inter-app contracts go through `packages/shared` |
| DB ownership | One PostgreSQL database, one Prisma schema |
| Auth | Single NextAuth session; Studio verifies via `arkiolSessionBridge` |
| Credits | All deductions/refunds go through `createCreditService` in shared |
| Billing | All Stripe events handled by `handleStripeEvent` in shared |

## Plans

| Plan | Credits/mo | Price | Studio Video | GIF | Concurrency |
|------|-----------|-------|-------------|-----|-------------|
| Free | 10/day | $0 | ❌ | ❌ | 1 |
| Creator | 500 | $25 | ❌ | ✅ | 2 |
| Pro | 1,700 | $79 | ✅ | ✅ | 5 |
| Studio | 6,000 | $249 | ✅ | ✅ | 15 |

## Credit Costs

| Type | Credits |
|------|---------|
| Static image | 1 |
| GIF motion | 5 |
| Video Standard | 40 |
| Video HQ | 80 |
| Video Long | 120 |
| ZIP export | 2 |

## Getting Started

```bash
# 1. Install dependencies (uses lockfile for reproducible install)
npm ci

# 2. Copy and fill environment variables
cp .env.example .env

# 3. Generate Prisma client
npm run db:generate

# 4. Run DB migrations
npm run db:deploy

# 5. Start ARKIOL Core (design studio)
npm run dev

# 6. Start Animation Studio (separate terminal)
npm run dev:studio

# 7. Run smoke test
npm run smoke-test
```

## Testing

```bash
# Unit tests (all workspaces, no DB required)
npm run test:unit --workspaces --if-present

# Integration tests (requires DATABASE_URL + REDIS_URL)
npm run test:integration --workspaces --if-present

# Full test suite
npm test --workspaces --if-present

# With coverage
npm run test:coverage --workspaces --if-present
```

**Test suite:** 2,663 tests across 68 files covering unit, integration, e2e, and smoke layers.  
See [TESTING.md](./TESTING.md) for full details.

## CI/CD

GitHub Actions runs on every push and pull request via `.github/workflows/ci.yml`:

1. **Install** — `npm ci` (lockfile-based, deterministic)
2. **Prisma generate** — from `packages/shared/prisma/schema.prisma`
3. **Lint** — ESLint across all workspaces
4. **Type-check** — `tsc --noEmit` across all workspaces
5. **Unit tests** — Jest across all workspaces
6. **Integration tests** — Jest with live Postgres + Redis
7. **Build** — production builds for all apps
8. **Migration check** — apply migrations to ephemeral DB
9. **HTTP smoke tests** — live server health checks

All deployments gate on the full CI pipeline passing.

## Key Architecture Decisions

**Credit deduction timing:** Credits are deducted at enqueue (not at start). If enqueue fails, the deduction is rolled back atomically.

**Free daily credits:** Stored in a separate `dailyCreditBalance` column. Reset daily by cron. Cannot accumulate.

**Soft rollover:** Pro/Studio orgs roll over 10–15% of unused credits into the next cycle.

**Stripe idempotency:** Every event is stored in `BillingEvent` before processing. Duplicate events detected by `stripeEvent` unique key.

**Grace period:** Failed payments trigger a 5-day grace period (static-only). After grace, org is downgraded to Free automatically.

**SSRF protection:** Outbound webhook URLs are validated against blocked IP ranges and internal hostname patterns before being persisted.

**Brand Asset Pipeline:** Uploaded assets are processed through a 6-stage AI pipeline (classify → bg-remove → color-extract → enhance → vectorize → motion-intel) and injected into generation scenes automatically.

---

## v3 Feature Extensions (Post-Launch Roadmap)

The following features were added after the initial v3 release. All are fully integrated with the existing credit economy, plan gates, and observability layer.

### Bulk Generation (`POST /api/generate/bulk`)
Generate up to 50 jobs in a single atomic transaction. PRO plan: 20 jobs/batch. STUDIO: 50 jobs/batch. Returns a `batchId` for status polling via `GET /api/jobs/batch/[batchId]`. Each job is independently queued through BullMQ with per-job error isolation — one failure does not cancel the batch.

### Template Packs (`GET|POST /api/generate/pack`)
10 curated format packs (social full set, launch bundle, ecommerce ads, studio mega pack, etc.) pre-configured with canonical formats, tone guidance, and example prompts. Plan-gated: CREATOR unlocks 6 packs, PRO 9, STUDIO all 10. Pack generation routes to the bulk engine on PRO/STUDIO and sequential campaign jobs on CREATOR.

### Brand Auto-Import (`POST /api/brand/extract`)
Accepts a `{ url }`, `{ logoUrl }`, or `{ logoBase64 }` and uses GPT-4o Vision (`detail: "low"`) to extract brand colors, typography, voice attributes, and tone keywords. Returns a pre-filled brand `suggestion` ready to save via `POST /api/brand`. URL mode uses SSRF guard + 8s timeout. 0 credits charged (browse → save is the user's choice).

### Multi-Language Copy
All generation endpoints accept `locale: string` (BCP-47, e.g. `"fr"`, `"ja"`, `"pt-BR"`). The brief analyzer injects a `LANGUAGE REQUIREMENT` into the GPT-4o system prompt, ensuring all headline, subheadline, CTA, and body copy are generated in the target language. Region suffixes (`fr-CA → French`) are handled automatically.

### A/B Export Pack
Export endpoint gains `abPack: boolean` and `promptLabel?: string`. When `abPack=true` + `format=zip`, the ZIP worker names files `creative_v1.png`, `creative_v2.png`, ... and appends `ab_manifest.json` with variation metadata (assetId, format, dimensions, brandScore, layoutFamily, promptLabel). Ready for bulk upload to Meta Ads Manager.

### Quality Score Dashboard (`GET /api/assets/quality`)
Accepts `?assetIds=`, `?jobId=`, or `?campaignId=`. Returns per-asset quality scores (0–100) across 6 dimensions, letter grade (A+/A/B/C/D), violation list, and data source (`benchmark` or `estimated`). Aggregate block: avgOverall, passRate (≥70), gradeDistribution, totalViolations, hierarchyPassRate.

### Scheduled Generation (`POST|GET|DELETE /api/generate/schedule`)
Schedule any generation job with a `runAt: ISO8601` timestamp. Uses BullMQ native `delay` — no separate cron worker. FREE/CREATOR: max 24h horizon, 10 pending jobs. PRO/STUDIO: 30-day horizon, 50 pending jobs. Min delay: 5 minutes. DELETE cancels the BullMQ delayed job and marks the DB record `CANCELLED`.

### Asset Resize (`POST /api/assets/resize`)
Re-rasterises a stored SVG at any target format's canonical dimensions using Sharp. Creates a new Asset record with `metadata.resizedFrom` lineage. 0 credits charged — layout adapts via SVG viewBox scaling. Max 9 target formats per call. Rejects if all requested formats match the source.

### White-label Automation API (`POST /api/automation/generate`) — STUDIO only
API-key-authenticated endpoint (`Authorization: Bearer nxr_live_<token>`) for programmatic generation from CMS integrations, headless e-commerce pipelines, or agency tools. Accepts up to 50 jobs with per-job `externalId`. On completion, delivers `automation.job.completed` directly to the caller's `webhookUrl` (HMAC-signed, 3-retry exponential backoff, 24h signed S3 download URLs included). `X-Arkiol-Delivery-Type: direct` header distinguishes automation deliveries from org-registered webhooks.

