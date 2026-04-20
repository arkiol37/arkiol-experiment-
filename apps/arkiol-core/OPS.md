# arkiol-core — Operations guide

Runtime ops for the scene engine + composition pipeline that lives under
`apps/arkiol-core`. This document covers what a site reliability / ops
engineer needs to run this sub-app in production.

The happy path is offline-safe: the scene composer, asset library, and
rejection rules have no network dependencies. Sections below describe
the optional integrations (Redis, CDN, metrics) and their degradation
modes when disabled.

---

## 1. Environment variables

See `PRODUCTION_ENV.md` at repo root for the full inventory. The
arkiol-core-specific section lists every variable this sub-app reads.
Short reference:

| Variable | Default | What breaks if missing |
|----------|---------|------------------------|
| `ARKIOL_MEMORY_STORE` | `in-memory` | Pack memory persists only in-process (lost on restart). |
| `REDIS_URL` | unset | Required only when `ARKIOL_MEMORY_STORE=redis`. |
| `ARKIOL_MEMORY_CAPACITY` | `1000` | Older records are evicted sooner. |
| `ARKIOL_3D_ASSET_BASE` | unset | 3D-asset slugs resolve to `undefined`; SVG scenes still render. |
| `ARKIOL_3D_ASSET_EXT` | `png` | Slug URLs use a different file extension. |
| `ARKIOL_METRICS_WINDOW` | `200` | Percentiles are computed over a smaller / larger window. |

---

## 2. Health & metrics

The sub-app exposes one live-traffic-safe endpoint:

```
GET /api/health/generation
```

No auth — intentional, so load-balancers and uptime probes can hit it.

Sample response:

```json
{
  "ok": true,
  "counters": {
    "generationsTotal": 4123,
    "generationsSucceeded": 3978,
    "generationsFailed": 145,
    "marketplaceApproved": 3602,
    "marketplaceRejected": 376,
    "heroMissing": 42
  },
  "successRate": 0.9648,
  "marketplacePassRate": 0.9054,
  "latency": {
    "samples": 200,
    "p50_ms": 412,
    "p90_ms": 798,
    "p99_ms": 1340
  },
  "recentRejections": [
    "marketplace:polished,layered",
    "hero_missing:brand_inject_failed"
  ]
}
```

### Alerting thresholds

| Metric | Page when | Reason |
|--------|-----------|--------|
| `successRate` | < 0.95 over 5 min | Pipeline regression. |
| `marketplacePassRate` | < 0.85 over 15 min | Quality regression (usually theme or asset library). |
| `latency.p99_ms` | > 3000 for 10 min | Over-allocated worker pool or Redis latency. |
| Endpoint 5xx | any | `/generation` is supposed to stay green even when the pipeline fails. |

---

## 3. Memory store (pack persistence)

By default, the arkiol-core memory store is in-process. Pack ids,
user-style affinities, and output history are held in a bounded
ring buffer (`ARKIOL_MEMORY_CAPACITY`). Single instance, single
process — good enough for demos.

For production, swap to Redis:

```bash
ARKIOL_MEMORY_STORE=redis
REDIS_URL=rediss://default:TOKEN@host:6380
```

The `RedisMemoryStore` in `src/engines/memory/store.ts` targets
Upstash Redis REST (serverless-safe). Tweak the client if you run
standalone Redis.

To confirm the driver at boot:

```bash
curl -s https://your-host/api/health/generation | jq '.memoryStore'
```

*(The `memoryStore` field is added by the snapshot reducer when a
non-default driver is configured.)*

---

## 4. 3D asset CDN

The pipeline prefers inline SVG scenes by default (deterministic,
offline-safe, ~5 KB each). For high-fidelity 3D PNGs, point
`ARKIOL_3D_ASSET_BASE` at a CDN with the files named
`<slug>.<ARKIOL_3D_ASSET_EXT>`, e.g.:

```
https://cdn.arkiol.ai/3d/nature-mountain-range.png
https://cdn.arkiol.ai/3d/object-dumbbell.png
https://cdn.arkiol.ai/3d/scene-city-skyline.png
```

The 33 slugs live in `src/engines/assets/3d-asset-manifest.ts`.
`asset3dManifestStats()` reports `configured: false` until both env
vars are set.

### CloudFront / CDN setup

1. Push the 33 PNGs (or WebPs) to S3 at `s3://<bucket>/3d/`.
2. Create a CloudFront distribution with that origin, `max-age` long
   (these are immutable, named by content).
3. Set `ARKIOL_3D_ASSET_BASE=https://<distribution-domain>/3d`.
4. Re-deploy. The health endpoint will start reporting
   `"3d": { "configured": true, "totalSlugs": 33 }`.

**Fallback:** if a slug 404s, the composition drops the 3D reference
and uses the inline SVG counterpart. No hard failure.

---

## 5. Test matrix

Runs in under 10 seconds on a laptop; wire into CI as-is.

```bash
# Pure-TS unit tests (48 tests, no Next/Prisma)
npx tsx tests/arkiol-core-unit.test.ts

# Exhaustive renders + E2E brief-to-gate smoke (1,620 renders + 5 briefs)
npx tsx tests/arkiol-core-integration.test.ts

# Throughput benchmarks (cold cache, warm cache, 2-phase gallery)
npx tsx tests/arkiol-core-benchmark.ts
```

CI should fail the job if any test exits non-zero. All three use `tsx`
directly — no build step, no framework dependencies.

---

## 6. Deployment runbook

1. **Verify** all three test scripts pass locally against the deploy
   branch.
2. **Dry-run** env diff: confirm `ARKIOL_*` and `REDIS_URL` match the
   target environment.
3. **Deploy** via the standard Next.js path (Vercel, or whichever
   platform carries the monorepo).
4. **Smoke** the health endpoint right after rollout:
   ```bash
   curl -s https://<host>/api/health/generation | jq '.ok, .latency.samples'
   ```
5. **Watch** `successRate` and `marketplacePassRate` for 15 minutes.
   Both should stay ≥ 0.95 on baseline traffic. Rollback if either
   drops and doesn't recover.

---

## 7. Degradation modes

| Failure | Effect | Mitigation |
|---------|--------|------------|
| Redis unreachable (when configured) | Memory store falls back to in-memory warning logged. | Pipeline keeps serving; pack coherence is per-process until Redis is back. |
| CDN 404 on a 3D slug | Composition substitutes inline SVG. | No user-visible failure. |
| `/api/health/generation` throws | Responds 500 with `ok: false`. | The endpoint itself never calls the pipeline, so a 500 indicates metrics-state corruption — restart the process. |
| Scene composer throws (unknown kind) | Surfaces a clear error `unknown scene kind "<x>"`. | Indicates a registry mismatch; ship a code fix, not a data fix. |

---

## 8. On-call commands

Quick checks you can run without shell access:

```bash
# Live metrics
curl -s https://<host>/api/health/generation | jq

# Force-clear scene memoization cache (no endpoint; ship a small admin
# route if you need this in prod — the default bounded cache is
# self-managing)

# Spot-check a specific scene render in a local REPL
npx tsx -e "import('./apps/arkiol-core/src/engines/assets/svg-scene-composer').then(m => console.log(m.renderScene('mountain-sunrise','motivation',0).length))"
```

---

## 9. Changelog pointers

Major arkiol-core changes land in `apps/arkiol-core/src/engines/`:

- `assets/svg-scene-composer.ts` — scene kinds + palette variants
- `assets/3d-asset-manifest.ts` — 3D CDN slug manifest
- `memory/store.ts` — memory-store drivers
- `evaluation/rejection-rules.ts` — gallery hard/soft rejection rules
- `evaluation/marketplace-gate.ts` — publish-ready threshold gate
- `render/pipeline.ts` — render orchestrator + metric hooks
- `render/svg-builder-ultimate.ts` — pack-anchor-aware builder
- `multi-output/coordinator.ts` — two-phase parallel gallery batch
- `lib/asset-library/` — asset catalog + category-driven selection
- `lib/generation-metrics.ts` — in-process counters + latency window

Scene kinds that exist today: 30 total. Full list in the `SceneKind`
union at the top of the scene catalog block in `svg-scene-composer.ts`.
