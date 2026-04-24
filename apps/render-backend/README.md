# ARKIOL Render Backend

Dedicated Node/Express service that runs the **heavy generation
pipeline** outside of Vercel. This is Step 1 of the Vercel / Render
split:

- **Vercel** (`apps/arkiol-core`) — UI, auth, plan enforcement,
  lightweight `/api/generate` proxy, polling endpoints (`/api/jobs`).
- **Render** (this service) — OpenAI calls, template composition,
  asset selection + injection, layout building, rendering, final
  output generation.

Both sides share the same Postgres (jobs are created by Vercel,
executed and updated by Render, polled by Vercel).

## Architecture flow

```
 user clicks Generate        user sees result
         │                           ▲
         ▼                           │
 ┌──────────────┐          ┌──────────────────┐
 │   Vercel     │          │   Vercel         │
 │ /api/generate│──POST───▶│ (poll /api/jobs) │
 │ (thin proxy) │          │                  │
 └──────┬───────┘          └──────────────────┘
        │                           ▲
        ▼                           │ reads DB
 ┌──────────────┐            ┌──────┴──────┐
 │  Render      │── writes──▶│  Postgres   │
 │  /generate   │            │  (jobs)     │
 │  (heavy work)│            └─────────────┘
 └──────────────┘
```

## Endpoints

| Method | Path             | Notes                                                  |
|--------|------------------|--------------------------------------------------------|
| GET    | `/`              | Health check (also `/health`).                         |
| POST   | `/generate`      | Starts a job. Requires `Authorization: Bearer <key>`.  |
| GET    | `/status/:jobId` | Current status + progress.                             |
| GET    | `/result/:jobId` | Final assets (COMPLETED) or error (FAILED).            |

### POST /generate

Only callable by the Vercel frontend — auth is a shared secret in
the `Authorization: Bearer <RENDER_GENERATION_KEY>` header.

The Vercel side has already created the job row in Postgres; the
backend receives the `jobId` plus generation inputs and runs the
pipeline. The job status / progress / final result are written back
to the shared database, so any polling client (the Vercel frontend
included) sees them.

Request body:
```json
{
  "jobId": "clx...",
  "userId": "clx...",
  "orgId": "clx...",
  "prompt": "Create a modern hero banner...",
  "formats": ["instagram_post"],
  "stylePreset": "auto",
  "variations": 3,
  "includeGif": false,
  "locale": "en",
  "expectedCreditCost": 30
}
```

Returns `202` with `{ jobId, status, accepted: true, durability: "render_backend" }`.

## Local development

```bash
cp apps/render-backend/.env.example apps/render-backend/.env
# edit .env with your DATABASE_URL + OPENAI_API_KEY + a dev RENDER_GENERATION_KEY

npm install
npx prisma generate --schema=packages/shared/prisma/schema.prisma
npm run dev --workspace=apps/render-backend
# → [render-backend] listening on :4100
```

Then, in your Vercel dev environment (`apps/arkiol-core/.env.local`):
```
RENDER_BACKEND_URL=http://localhost:4100
RENDER_GENERATION_KEY=<same as render backend>
```

and `/api/generate` on the Vercel side will forward every request
to this service — Vercel no longer runs the heavy pipeline inline.

## Deploying to Render

The repo root contains a [`render.yaml`](../../render.yaml) blueprint.
Point Render at this repository, let it detect the blueprint, and
populate the following secrets in the Render dashboard:

- `DATABASE_URL` — same Postgres as the Vercel deploy
- `OPENAI_API_KEY`
- `RENDER_GENERATION_KEY` — generate once (`openssl rand -hex 32`)
  and set the same value on Vercel
- `ALLOWED_ORIGINS` — comma-separated list of Vercel origins, e.g.
  `https://app.arkiol.com,https://arkiol.vercel.app`
- `S3_*` — optional; storage falls back to inline SVG data URLs

Build command (defined in `render.yaml`):
```
npm install --legacy-peer-deps
npx prisma generate --schema=packages/shared/prisma/schema.prisma
npm run type-check --workspace=apps/render-backend
```

Start command:
```
npm run start --workspace=apps/render-backend
```

Health check path: `/health`.

## Vercel route is a thin forwarder

`apps/arkiol-core/src/app/api/generate/route.ts` no longer runs the
heavy pipeline. If `RENDER_BACKEND_URL` + `RENDER_GENERATION_KEY`
are unset, or the Render service rejects the request, `/api/generate`
returns a 5xx and the created job row is flipped to FAILED so the
UI shows a real error instead of hanging on PENDING. This also
means the Vercel serverless function can no longer hit a timeout on
the generation path.
