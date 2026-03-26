# Animation Studio — Production Deployment Guide

> Enterprise-grade AI video rendering SaaS. Build, deploy, and scale.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (TLS termination)                  │
└────────────┬────────────────────────────┬───────────────────────┘
             │                            │
    ┌────────▼────────┐          ┌────────▼────────┐
    │   API (×2)       │          │  Frontend (×1)  │
    │   Express/Node   │          │   React + Vite  │
    └────────┬────────┘          └─────────────────┘
             │
    ┌────────▼────────────────────────────────────┐
    │              Bull Queue (Redis)              │
    └────────┬────────────────────────────────────┘
             │
    ┌────────▼────────┐
    │  Worker (×2)    │  ← FFmpeg + ElevenLabs + AI providers
    │  Render pipeline│
    └────────┬────────┘
             │
    ┌────────▼────────────────────────────────────┐
    │     PostgreSQL 16 + Redis 7 + S3 + CDN      │
    └─────────────────────────────────────────────┘
```

## Prerequisites

- Docker 24+ with Docker Compose v2
- AWS account with S3 + CloudFront configured
- Stripe account (keys + webhook endpoint registered)
- Domain with DNS pointed to server
- SSL certificate (Let's Encrypt recommended)
- At least one AI video provider API key (Runway, Pika, or Sora)

## Quick Start (Development)

```bash
# 1. Clone and configure
cp backend/.env.example backend/.env
# Edit backend/.env with your keys

# 2. Generate secrets
echo "JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')" >> backend/.env
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 64 | tr -d '\n')" >> backend/.env
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> backend/.env

# 3. Start infrastructure
docker compose up postgres redis -d

# 4. Run migrations
cd backend && npm run migrate

# 5. Start API + worker
npm run dev &
npm run worker &

# 6. Start frontend
cd ../frontend && npm run dev
```

## Production Deployment

### 1. Build Docker image
```bash
docker build -t animation-studio-backend:latest ./backend
```

### 2. Configure environment
```bash
cp backend/.env.example .env.prod
# Fill in all production values
```

### 3. Register Stripe webhook
```bash
# Stripe Dashboard → Webhooks → Add endpoint
# URL: https://animation-studio.ai/api/webhooks/stripe
# Events: checkout.session.completed, customer.subscription.updated,
#         customer.subscription.deleted, invoice.payment_failed, invoice.paid
```

### 4. Deploy
```bash
IMAGE_TAG=latest docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml run --rm migrate
```

---

## Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | 32+ char secret for access tokens |
| `JWT_REFRESH_SECRET` | 32+ char secret for refresh tokens |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `S3_BUCKET_ASSETS` | S3 bucket for user uploads |
| `S3_BUCKET_RENDERS` | S3 bucket for render outputs |
| `CDN_URL` | CloudFront distribution URL |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256 |
| `API_URL` | Public API URL |
| `FRONTEND_URL` | Public frontend URL |

## Optional Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RUNWAY_API_KEY` | — | Runway ML API key |
| `PIKA_API_KEY` | — | Pika Labs API key |
| `SORA_API_KEY` | — | OpenAI Sora API key |
| `ELEVENLABS_API_KEY` | — | ElevenLabs TTS key |
| `SENDGRID_API_KEY` | — | SendGrid for email |
| `SENTRY_DSN` | — | Error tracking |
| `RENDER_CONCURRENCY` | `3` | Jobs per worker process |
| `FFMPEG_TIMEOUT_MS` | `600000` | FFmpeg hard timeout (10 min) |
| `SCENE_POLL_TIMEOUT_MS` | `300000` | Per-scene provider timeout (5 min) |

---

## Render Pipeline Flow

```
User submits render
  → Credit reservation (debit immediately)
  → Idempotency check (prevent duplicates)
  → Bull queue (priority by plan tier)
  → Worker picks up job
    → Scene generation (parallel batches of 3)
       → Provider API call (Runway/Pika/Sora)
       → Poll until complete (exp. backoff, 5 min timeout)
       → Fallback to secondary provider on failure
    → Voiceover (ElevenLabs TTS → S3)
    → Music track selection
    → Subtitle generation (word-accurate timing)
    → FFmpeg pipeline:
       ↓ Download all scene videos
       ↓ Normalize to target resolution
       ↓ Concatenate with xfade transitions
       ↓ Mix voice + music (volumes normalized)
       ↓ Burn subtitle SRT
       ↓ Final H.264 transcode (+faststart)
       ↓ Generate thumbnail
       ↓ Export to 3 aspect ratios (9:16, 1:1, 16:9)
    → Upload all outputs to S3 + CDN
    → Quality validation via ffprobe
    → Cleanup temp files
  → Mark complete + notify user via email
  → Track analytics
```

## Failure Handling

| Scenario | Behavior |
|---|---|
| Scene generation fails | Skip scene, continue with rest (partial render) |
| ALL scenes fail | Job fails, credits refunded |
| FFmpeg crash | Job fails, Bull retries with exponential backoff |
| Max retries exceeded | Dead-letter queue, credits refunded, admin alerted |
| User cancels job | Immediately cancelled, credits refunded |
| Stripe webhook duplicate | Idempotently ignored via billing_events table |
| Worker crashes | Bull stall detection re-queues job |

## Monitoring

```bash
# Live queue metrics
GET /api/admin/render-queue  # (admin only)

# Health check
GET /api/health        # Basic liveness
GET /api/health/ready  # DB + Redis + queue health

# Bull Board UI
http://localhost:3001/admin/queues  # (internal only)

# Logs
docker compose -f docker-compose.prod.yml logs -f api worker
```

## Scaling

- **API**: Horizontal — add replicas (stateless)
- **Workers**: Horizontal — each handles `RENDER_CONCURRENCY` concurrent jobs
- **FFmpeg**: Memory-intensive — allocate 2GB RAM per worker
- **Database**: Vertical first, then read replicas for analytics
- **Redis**: Sentinel or Cluster for HA

### Recommended starting configuration
- 2 API replicas (0.5 CPU, 512MB each)
- 2 Worker replicas (2 CPU, 2GB each)
- PostgreSQL: 2 CPU, 4GB RAM
- Redis: 1 CPU, 512MB

## Security Notes

1. `ENCRYPTION_KEY` encrypts all provider API keys at rest (AES-256-GCM)
2. JWT access tokens expire in 15 minutes
3. Stripe webhook signatures verified before processing
4. All S3 download URLs are time-limited (presigned, 1-hour TTL)
5. Rate limiting applied at nginx and Express layers
6. All user passwords hashed with Argon2id
7. SQL injection impossible via parameterized Knex queries

## Troubleshooting

**Render stuck in `queued`**: Check Redis connection, worker logs, queue metrics

**FFmpeg errors**: Verify FFmpeg installed with `ffmpeg -version`, check codec support with `ffmpeg -codecs | grep libx264`

**ElevenLabs TTS failures**: Graceful — render continues without voiceover; check API key and quota

**Provider all-fail**: Ensure at least one provider API key is configured; check provider status pages

**Stripe webhooks failing**: Verify STRIPE_WEBHOOK_SECRET matches dashboard; check raw body parsing is applied to /api/webhooks/stripe

**High memory usage**: Scale down RENDER_CONCURRENCY or increase worker memory limit; FFmpeg is memory-intensive for 4K exports
