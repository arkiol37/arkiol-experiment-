# Worker Hosting Guide

The Arkiol generation worker is a long-running Node.js process that:
- Consumes jobs from the `arkiol:generation` BullMQ queue
- Calls GPT-4o for brief analysis and content generation
- Renders SVG/PNG/GIF using `sharp` and `canvas` (native binaries)
- Uploads assets to S3
- Updates job status in PostgreSQL

**It cannot run on Vercel** (serverless limitations, native binary requirements).

---

## Option 1: Railway (Recommended)

1. Create a new Railway service pointing to this repo
2. Set start command: `npm run worker:prod`
3. Set all worker env vars (see below)
4. The `railway.json` in the repo root configures this automatically

```json
// railway.json (already in repo)
{
  "build": { "builder": "NIXPACKS" },
  "deploy": { "startCommand": "npm run worker:prod", "restartPolicyType": "ON_FAILURE" }
}
```

---

## Option 2: Fly.io

```bash
flyctl launch --config fly.toml
flyctl deploy
```

The `fly.toml` defines two process groups:
- `web` → the Next.js API (not needed if using Vercel for web)
- `worker` → `npm run worker:prod`

Scale workers independently:
```bash
flyctl scale count worker=3
```

---

## Option 3: Docker

```bash
docker-compose -f docker-compose.worker.yml up -d
```

Scale:
```bash
docker-compose -f docker-compose.worker.yml up -d --scale worker=3
```

---

## Option 4: PM2 (Self-hosted VPS)

```bash
npm install -g pm2
pm2 start "npm run worker:prod" --name arkiol-worker
pm2 startup
pm2 save
```

---

## Required Environment Variables (Worker)

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/arkiol

# OpenAI (server-only — never expose to client)
OPENAI_API_KEY=sk-...

# Redis (BullMQ queue)
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_TLS=true  # set to "true" for Upstash/managed Redis

# S3 Storage
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=arkiol-assets
S3_REGION=us-east-1
S3_CDN_BASE=https://cdn.yourapp.com  # optional CDN prefix

# Font CDN (optional, for SVG font embedding)
FONT_CDN_BASE_URL=https://cdn.yourapp.com/fonts

# Worker tuning
WORKER_CONCURRENCY=3  # parallel jobs per worker instance

# Monitoring
SENTRY_DSN=https://...@sentry.io/...  # optional
```

---

## Retry + Dead-Letter Queue Behavior

1. Job fails → BullMQ retries with exponential backoff
   - Attempt 1: immediate
   - Attempt 2: 3s delay
   - Attempt 3: 9s delay

2. After 3 failures:
   - Job moved to `arkiol:dlq` queue
   - DB `job.status` = `FAILED`, `job.result.dlq = true`
   - Webhook `job.failed` fired to org

3. Monitor DLQ:
   ```
   GET /api/monitoring/dlq
   ```

4. Retry from DLQ:
   ```
   POST /api/monitoring/dlq  {"action":"retry","jobId":"job_xxx"}
   ```

---

## Health Monitoring

The worker logs to stdout in JSON (pino format). Key events:

```json
{"event":"job_started","jobId":"...","formatsCount":3}
{"event":"job_completed","jobId":"...","assetCount":3,"creditCost":3}
{"event":"job_dead_lettered","jobId":"...","error":"...","attempts":3}
```

Ship logs to Datadog/Papertrail/Logtail via a log drain or pino transport.

---

## Scaling Guidelines

| Monthly Assets | Workers | Concurrency |
|---|---|---|
| < 10k | 1 | 3 |
| 10k–50k | 2 | 3 |
| 50k–200k | 4 | 5 |
| 200k+ | Auto-scale | 5–8 |

Each worker at concurrency=3 handles ~3 assets simultaneously. Target <10s per asset = ~18 assets/minute per worker.
