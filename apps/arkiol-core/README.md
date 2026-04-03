# Arkiol — AI Design SaaS Production Backend

Generate professional design assets across 9 practical categories using AI-powered layout authority, brand consistency, and a near-Canva-level editor.

## Categories

| Category | Canvas | Export | GIF |
|---|---|---|---|
| Instagram Post | 1080×1080 | SVG, PNG | ✓ |
| Instagram Story | 1080×1920 | SVG, PNG | ✓ |
| YouTube Thumbnail | 1280×720 | SVG, PNG | — |
| Flyer | 2550×3300 (US Letter) | SVG, PNG | — |
| Poster | 2480×3508 (A4) | SVG, PNG | — |
| Presentation Slide | 1920×1080 | SVG, PNG | — |
| Business Card | 1050×600 | SVG, PNG | — |
| Resume | 2550×3300 | PNG | — |
| Logo | 1000×1000 | SVG, PNG | — |

YouTube Thumbnail includes AUTO face/product mode (controlled via `youtubeThumbnailMode: "auto" | "face" | "product"`).

---

## Quick Start

### Prerequisites
- Node.js ≥ 20
- PostgreSQL database
- Redis (for BullMQ worker queue)
- OpenAI API key
- AWS S3 bucket (for asset storage)

### 1. Install
```bash
npm ci
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in all values — see .env.example for documentation
```

### 3. Database setup
```bash
# Development
npm run db:migrate       # runs prisma migrate dev

# Production (run manually BEFORE deploying — never in build)
npm run db:deploy        # runs prisma migrate deploy
```

### 4. Build
```bash
npm run build            # prisma generate + next build (no migration)
```

### 5. Start
```bash
npm start               # Next.js API server
npm run worker:prod     # BullMQ generation worker (separate process)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Vercel (Next.js API)                               │
│  POST /api/generate → enqueue BullMQ job            │
│  POST /api/export   → serve SVG/PNG/GIF from S3     │
│  GET  /api/jobs/:id → poll job status               │
└──────────────────────┬──────────────────────────────┘
                       │ BullMQ via Redis
┌──────────────────────▼──────────────────────────────┐
│  Worker (Railway / Fly.io / EC2)                    │
│  analyzeBrief → resolveLayoutSpec → renderAsset     │
│  → upload to S3 → update DB job status              │
└─────────────────────────────────────────────────────┘
```

### Generation Pipeline

Every asset goes through 8 deterministic stages:

1. **resolveLayoutSpec** — Layout Authority selects family + variation from the 9-category registry
2. **analyzeDensity** — Typography & spacing budget per format category
3. **buildCompositionPlan** — Asset contract + element roster
4. **buildSvgContent** — GPT-4o generates content within zone constraints
5. **enforceHierarchy** — Typographic rule enforcement (font-size ratios)
6. **enforceStyle** — WCAG contrast + brand tone validation
7. **renderSvg/Png/Gif** — Format-specific rendering using bundled DejaVu/Liberation fonts
8. **Upload to S3** — Deterministic asset ID from inputs (no random UUIDs)

---

## Vercel API Deployment

> **Important**: Never run `prisma migrate deploy` during the Vercel build. Migrations must be run manually before deploying.

### Steps

1. **Run migrations first** (from your local machine or CI, against production DB):
   ```bash
   DATABASE_URL="postgresql://..." npm run db:deploy
   ```

2. **Set environment variables** in Vercel dashboard (or via CLI):
   ```bash
   vercel env add DATABASE_URL
   vercel env add NEXTAUTH_SECRET
   vercel env add OPENAI_API_KEY
   vercel env add AWS_ACCESS_KEY_ID
   vercel env add AWS_SECRET_ACCESS_KEY
   vercel env add S3_BUCKET_NAME
   vercel env add S3_REGION
   vercel env add REDIS_URL
   vercel env add UPSTASH_REDIS_REST_URL
   vercel env add UPSTASH_REDIS_REST_TOKEN
   ```

3. **Deploy**:
   ```bash
   vercel --prod
   ```
   
   The `vercel.json` `buildCommand` is `node scripts/vercel-prisma-generate.cjs && next build` — no migration.

4. **Verify health**:
   ```bash
   curl https://your-app.vercel.app/health
   ```

### Serverless Limits

- `/api/generate` — 30s timeout, 512MB (enqueues; fast)
- `/api/export` — 60s timeout, 3008MB (PNG/GIF render from SVG source)
- All heavy rendering happens in the **worker** (not on Vercel)

---

## Worker Hosting (Separate Process)

The BullMQ worker **cannot** run on Vercel (needs long-lived process + native binaries).

### Railway

```bash
# Procfile
worker: npm run worker:prod
```

Or use the provided `railway.json`.

### Fly.io

```bash
flyctl deploy --config fly.toml
# Worker is defined in fly.toml with separate process group
```

### Docker

```bash
docker-compose -f docker-compose.worker.yml up -d
```

### Worker environment variables (all required)

```
DATABASE_URL
REDIS_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_TLS
OPENAI_API_KEY
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET_NAME / S3_REGION
WORKER_CONCURRENCY=3   # parallel job limit
```

### Retry / Dead-Letter Queue

Workers retry failed jobs up to **3 times** with exponential backoff (3s base). After 3 failures:
- Job moved to `arkiol:dlq` queue
- DB `job.status` → `FAILED` with `dlq: true` in result
- `job.failed` webhook delivered to org

Monitor DLQ via `GET /api/monitoring/dlq`.

---

## Editor Integration

The `ArkiolEditor` component (`src/components/editor/ArkiolEditor.tsx`) provides:

- Smart snapping + alignment guides (6px threshold, canvas edges + element edges)
- Multi-select with group transformations (align left, align top, center H)
- Constraint-based resizing via 8-handle resize grips
- Inline text editing with live font controls (family, size, weight, color, align, leading)
- History / undo-redo (Ctrl+Z / Ctrl+Y, 50-step buffer)
- Layer panel with z-index ordering
- Keyboard shortcuts: Delete, Escape, Ctrl+Z/Y

```tsx
import { ArkiolEditor } from "@/components/editor/ArkiolEditor";

<ArkiolEditor
  initialElements={elements}
  canvasWidth={1080}
  canvasHeight={1080}
  onSave={(elements) => saveToAPI(elements)}
/>
```

---

## Campaign Mode

Multi-template generation creates **deterministic** assets across all formats:

```bash
POST /api/campaigns
{
  "name": "Summer Launch",
  "prompt": "Premium skincare launch — clean, modern, trust-building",
  "formats": ["instagram_post", "instagram_story", "flyer"],
  "variations": 3,
  "brandId": "brand_xxx"
}
```

The same `campaignId` + `variationIdx` + `format` hash always produces the same layout family and variation. This guarantees visual consistency across all assets in a campaign.

---

## Tests

```bash
npm test                # all unit tests
npm run test:e2e        # end-to-end pipeline test
npm run test:integration # API route integration tests
npm run test:coverage   # coverage report
```

---

## Fonts

Bundled fonts in `assets/fonts/` (DejaVu + Liberation families, TTF):
- Used by `canvas` (PNG/GIF rendering) and referenced in SVG `@font-face`
- Set `FONT_CDN_BASE_URL` env var to serve fonts from CDN for SVG embedding
- Run `npm run verify:fonts` to validate all fonts load correctly

---

## Environment Variables Reference

See `.env.example` for full documentation. Required for production:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | NextAuth.js secret (32+ chars) |
| `NEXTAUTH_URL` | Your production URL |
| `OPENAI_API_KEY` | OpenAI key (server-only, never client) |
| `AWS_ACCESS_KEY_ID` | S3 access |
| `AWS_SECRET_ACCESS_KEY` | S3 secret |
| `S3_BUCKET_NAME` | Asset storage bucket |
| `S3_REGION` | AWS region |
| `REDIS_HOST` | Redis for BullMQ |
| `UPSTASH_REDIS_REST_URL` | Rate limiting (Upstash) |
| `STRIPE_SECRET_KEY` | Billing (optional) |
| `SENTRY_DSN` | Error monitoring (optional) |
