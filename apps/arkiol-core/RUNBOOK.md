# Arkiol Operations Runbook

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App (Vercel)          │  Worker (Railway/Fly/EC2)      │
│  ─────────────────────────     │  ────────────────────────────  │
│  /api/generate → enqueue       │  npm run worker:prod           │
│  /api/jobs → status            │  • BullMQ consumer             │
│  /api/assets → CRUD            │  • renderAsset() pipeline      │
│  /api/export → download        │  • uploads PNG/SVG to S3       │
│  /api/brand → brand kit        │  • updates job status in DB    │
└────────────────────────────────┴────────────────────────────────┘
         │                                   │
         ▼                                   ▼
   PostgreSQL (Neon/Railway)        Redis (Upstash/Railway)
```

---

## 1. Environment Variables

### Next.js App

```bash
# Database
DATABASE_URL="postgresql://user:pass@host/arkiol?sslmode=require"

# NextAuth
NEXTAUTH_URL="https://your-app.vercel.app"
NEXTAUTH_SECRET="<run: openssl rand -base64 32>"

# OpenAI — SERVER ONLY, never exposed client-side
OPENAI_API_KEY="sk-..."
OPENAI_ORG_ID="org-..."

# Redis (BullMQ job queue)
REDIS_HOST="your-redis-host"
REDIS_PORT="6379"
REDIS_PASSWORD="your-redis-password"
REDIS_TLS="true"

# S3
S3_BUCKET_NAME="arkiol-assets"
S3_REGION="us-east-1"
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="..."

# Stripe (optional)
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Sentry (optional)
SENTRY_DSN="https://...@sentry.io/..."

# Email (optional)
SMTP_HOST="smtp.resend.com"
SMTP_PORT="465"
SMTP_USER="resend"
SMTP_PASS="re_..."
EMAIL_FROM="noreply@yourdomain.com"
```

### Worker (all above + optional)

```bash
WORKER_CONCURRENCY="3"        # parallel jobs
```

---

## 2. Local Development

```bash
# Install deps (generates package-lock.json)
npm install

# Start Redis locally
docker run -d -p 6379:6379 redis:alpine

# Setup DB
npm run db:push
npm run db:seed

# Start app + worker
npm run dev          # terminal 1
npm run worker       # terminal 2
```

---

## 3. Database

```bash
# First deploy
npm run db:deploy

# Development
npm run db:migrate   # create + apply

# Production
npm run db:deploy    # apply only — run BEFORE deploy

# Studio
npm run db:studio
```

---

## 4. Worker Deployment

### Railway
Set start command: `npm run worker:prod`

### Fly.io
```bash
fly deploy --config fly.toml
fly scale count 2
```

### Docker
```bash
docker-compose -f docker-compose.worker.yml up -d
```

---

## 5. API Reference

### Generate
```bash
POST /api/generate
Authorization: Bearer nxr_...
{
  "prompt": "Bold summer sale for a streetwear brand",
  "formats": ["instagram_post", "youtube_thumbnail"],
  "stylePreset": "bold_editorial",
  "variations": 2,
  "youtubeThumbnailMode": "auto"  # auto | face | product
}
```

### Poll status
```bash
GET /api/jobs?id=<jobId>
# { "job": { "status": "COMPLETED", "progress": 100 }, "assets": [...] }
```

### Export
```bash
POST /api/export
{ "assetIds": ["..."], "outputFormat": "zip" }
```

---

## 6. The 9 Arkiol Categories (Single Source of Truth)

| Key | Label | Dimensions |
|-----|-------|------------|
| `instagram_post` | Instagram Post | 1080×1080 |
| `instagram_story` | Instagram Story | 1080×1920 |
| `youtube_thumbnail` | YouTube Thumbnail | 1280×720 |
| `flyer` | Flyer | 2550×3300 |
| `poster` | Poster | 2480×3508 |
| `presentation_slide` | Presentation Slide | 1920×1080 |
| `business_card` | Business Card | 1050×600 |
| `resume` | Resume | 2550×3300 |
| `logo` | Logo | 1000×1000 |

Enforced in: `src/lib/types.ts`, `src/engines/layout/families.ts`, `/api/generate`, UI pickers.

---

## 7. BullMQ Job Lifecycle

```
QUEUED → RUNNING → COMPLETED
                  → FAILED (3 retries, exponential backoff)
                          → DLQ (inspect at /api/monitoring/dlq)
```

Progress: 2% → 8% → 10–95% per render → 100%

---

## 8. Health

```bash
curl https://your-app.vercel.app/api/health
curl https://your-app.vercel.app/api/monitoring
curl https://your-app.vercel.app/api/monitoring/dlq
```

---

## 9. Deploy Checklist

```
[ ] npm run db:deploy
[ ] npm run test
[ ] vercel --prod
[ ] GET /api/health → ok
[ ] Generate 1 test asset
```

---

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Jobs stuck at QUEUED | Start worker: `npm run worker:prod` |
| Jobs fail immediately | Check OPENAI_API_KEY env var |
| S3 errors | Verify AWS_* env vars |
| Redis errors | Verify REDIS_* env vars |
| Font issues | `npm run verify:fonts` |
| DLQ growing | Check worker logs, inspect /api/monitoring/dlq |
