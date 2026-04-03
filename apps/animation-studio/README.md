# Animation Studio

> AI-powered video rendering SaaS — enterprise-grade, fully production-ready.

Create multi-scene branded video campaigns with AI video generation, voiceover synthesis, music scoring, subtitle burn-in, and multi-format MP4 delivery.

---

## Features

- **AI Video Generation** — Runway ML, Pika Labs, Sora with automatic fallback
- **Voice Synthesis** — ElevenLabs TTS with 10+ voice profiles, word-level subtitle timing
- **FFmpeg Pipeline** — stitch, mix, transcode, export to 9:16 / 1:1 / 16:9
- **Stripe Billing** — plans, credit packs, idempotent webhooks, failed payment handling
- **Job Queue** — Bull + Redis with retries, backoff, dead-letter, and credit refunds
- **RBAC** — JWT auth, workspace roles, API key authentication
- **S3 + CloudFront** — asset uploads, render delivery, GDPR-compliant deletion
- **Admin Dashboard** — queue diagnostics, cost monitoring, credit adjustments

## Stack

| Layer | Technology |
|---|---|
| API | Node.js 20 + TypeScript + Express |
| Queue | Bull + Redis 7 |
| Database | PostgreSQL 16 + Knex |
| Video | FFmpeg (libx264, libass) |
| Storage | AWS S3 + CloudFront |
| Frontend | React + Vite + TailwindCSS |
| CI/CD | GitHub Actions + Docker |

## Quick Start

```bash
bash setup.sh
# Then follow the prompts
```

See [PRODUCTION.md](./PRODUCTION.md) for full deployment documentation.

## Project Structure

```
animation-studio/
├── backend/                 # Node.js API + Bull workers
│   ├── src/
│   │   ├── auth/            # JWT + OAuth authentication
│   │   ├── billing/         # Stripe integration + credit system
│   │   ├── config/          # Env, DB, Redis, logger
│   │   ├── jobs/            # Bull render queue + processing
│   │   ├── middleware/       # Auth, errors, rate limiting
│   │   ├── migrations/      # PostgreSQL schema migrations
│   │   ├── providers/       # Runway, Pika, Sora adapters
│   │   ├── routes/          # REST API endpoints
│   │   ├── services/        # FFmpeg, storage, voice, subtitles
│   │   └── workers/         # Standalone render worker process
│   └── tests/               # Unit, integration, E2E test specs
├── frontend/                # React + Vite SPA
├── infrastructure/          # Nginx config, DB init SQL
├── docker-compose.yml       # Development stack
├── docker-compose.prod.yml  # Production stack (replicas, limits)
└── PRODUCTION.md            # Full deployment guide
```

## License

Private — all rights reserved.
