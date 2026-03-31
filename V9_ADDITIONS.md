[V9_ADDITIONS.md](https://github.com/user-attachments/files/26391729/V9_ADDITIONS.md)
# ARKIOL v3 — Production Platform Features

This document describes every new component added in the v9 upgrade.
All additions are backward-compatible and fully integrated with existing
v8 architecture (archetypes, brand learning, GIF motion, pipeline orchestrator).

---

## 1. Creative Exploration Engine (fully wired)

**Files:** `src/engines/exploration/` (5 modules, already present in v8)

The existing exploration engine (E1→E5) is now fully integrated with:
- **DB-backed priors persistence** via `ExplorationPriors` table
- **DB-backed novelty archive** via `NoveltyArchiveEntry` table
- **Feedback route** (`/api/explore/feedback`) that persists signals and updates bandit weights
- **Priors persistence bridge** (`src/engines/exploration/priors-persistence.ts`)

### Bandit Learning Flow
```
User selects design → POST /api/explore/feedback → loadPriors → applyFeedback → savePriors
Next exploration run → loadPriors → runExploration(priors) → better candidates
```

---

## 2. Platform Intelligence Engine

**File:** `src/engines/platform/intelligence.ts`  
**API:** `GET /api/platform?format=<format>`, `POST /api/platform/score`

Provides per-platform composition rules for 15+ platforms:
- YouTube Thumbnail / Shorts
- Instagram Post / Story
- TikTok Ad
- LinkedIn Post / Banner
- Twitter/X Post
- Facebook Ad
- Google Display (Leaderboard, Rectangle)
- Print (Flyer A4)

### Key exports
```typescript
getPlatformRules(format: string): PlatformRules
scorePlatformCompliance(genome, format): PlatformComplianceScore
buildPlatformPromptContext(format): string  // injected into AI prompts
```

### PlatformRules includes
- Canonical pixel dimensions
- Safe zones (fractions) for UI overlays
- Typography minimums (headline/body px)
- Preferred composition biases (face_right, top_text, etc.)
- Effective hooks and archetypes per platform
- Quality notes for AI prompt enrichment

---

## 3. Structured Asset Library

**File:** `src/engines/assets/asset-library.ts`  
**API:** `GET /api/assets/library`, `POST /api/assets/library/retrieve`

### Style Packs (7 industry packs, 27+ assets)
- `tech_core` — Circuit patterns, data flows, mesh gradients
- `fitness_core` — Motion blur, grit textures, clean performance
- `food_core` — Rustic wood, dark slate, fresh botanicals
- `fashion_core` — Marble, silk fabric, dark editorial
- `finance_core` — Corporate navy, clean fintech, abstract charts
- `education_core` — Warm learning, digital classroom
- `entertainment_core` — Cinematic dark, neon glow, concert lights
- `generic_core` — Universal fallbacks

### Intelligent Retrieval
```typescript
retrieveAssets(context: RetrievalContext, maxResults = 3): RetrievedAsset[]
```
Scores assets by: industry match (0.35), dark-bg preference (0.15), 
colour affinity (0.15), tone alignment (0.15), audience match (0.10), mood (0.10)

### Parametric Asset Generation
```typescript
generateParametricBackground(seed, primaryColor, style): string  // Returns SVG
// Styles: "gradient" | "mesh" | "dots" | "waves" | "geometric"
```
All generation is deterministic from seed — same seed always produces same SVG.

---

## 4. Campaign Creative Director AI

**File:** `src/engines/campaign/creative-director.ts`  
**API:** `POST /api/campaigns/director`  
**UI:** `src/components/dashboard/CampaignDirectorView.tsx`  
**Route:** `/campaign-director`

### Single-prompt → multi-format campaign
```typescript
buildCampaignPlan({ prompt, brandId?, brandPrimaryColor?, requestedFormats?, seed? }): CampaignPlan
```

### CampaignPlan includes
- `objective`: detected campaign goal (awareness/engagement/conversion/retention/announcement)
- `identity`: VisualIdentity with shared palette, typography, headline, CTA, hook, composition
- `formats`: CampaignFormatPlan[] — per-format adaptations with role, headline, archetype, motion
- `sharedPromptContext`: string injected into every format's generation prompt
- `estimatedCredits`: total credit cost estimate
- `generationOrder`: priority-sorted format list

### Campaign Objectives → Format Sets
| Objective | Formats |
|-----------|---------|
| awareness | YouTube, Instagram Post, Story, Twitter, LinkedIn |
| engagement | Instagram, TikTok, Twitter |
| conversion | Facebook, Instagram, Google Display, YouTube |
| announcement | YouTube, Instagram, Twitter, LinkedIn, Facebook |

### Queue Integration
`POST /api/campaigns/director` with `queueJobs: true` immediately dispatches 
all format generation jobs to BullMQ with priority-based ordering (hero = critical).

---

## 5. Render Queue Intelligence

**File:** `src/engines/queue/render-queue.ts`

### Priority System
```
critical → hero campaign formats, first-ever generation
high     → standard first generation
normal   → campaign supporting formats, regeneration
low      → background/batch jobs
```
Priority weights: `critical=100, high=50, normal=20, low=5`  
Age bonus prevents starvation: `+0.01/second`

### Retry Controller
- Exponential backoff with configurable multiplier and jitter
- Non-retriable errors: `kill_switch_active`, `credit_insufficient`, `content_policy_violation`
- Per-priority retry policies (critical: 5 attempts, low: 2 attempts)

### Timeout Guard
```typescript
withTimeout(promise, timeoutMs, jobId): Promise<T>
// Rejects with RenderTimeoutError(code="RENDER_TIMEOUT") after timeoutMs
```

### Provider Router + Health Tracker
```typescript
buildProviderChain("openai", excludeProviders): ProviderName[]
// Returns: [openai, stability, replicate, local, fallback_svg]
// Excludes unhealthy providers (>3 failures in 60s window)
```

### Cost Monitor (idempotent)
```typescript
const monitor = new CostMonitor();
monitor.record({ orgId, jobId, provider, costUsd, idempotencyKey });
monitor.checkBudget("orgId"): ComputeBudgetStatus
```
Limits: `$25/hour/org`, `$100/day/org`, `$2/job max`

### Compute Safety Guard
```typescript
checkComputeSafety(job, activeJobCount, costMonitor): SafetyCheckResult
// Checks: concurrent limit (5/org), job budget, hourly/daily spend
```

---

## 6. Observability (Structured Logging, Metrics, Tracing, Diagnostics)

**File:** `src/lib/observability.ts`  
**API:** `GET /api/admin/diagnostics`  
**UI:** `src/components/dashboard/DiagnosticsDashboard.tsx`  
**Route:** `/admin/diagnostics`

### MetricsRegistry
```typescript
metrics.increment("name", labels, amount)
metrics.gauge("name", value, labels)
metrics.observe("name", value, labels)  // histogram
metrics.getHistogramStats("name"): { count, min, max, avg, p50, p95, p99 }
metrics.snapshot(): MetricSample[]
```

### TraceBuilder
```typescript
const builder = new TraceBuilder(traceId);
const spanId = builder.startSpan("stage_name", { format: "ig_post" });
builder.endSpan(spanId, { ok: true, attributes: { fallback: false } });
const diagnostic = builder.buildDiagnostic(runId);
// Returns: PipelineDiagnostic with stages[], overallStatus, fallbackCount
```

### Engine Telemetry Hooks
```typescript
recordExplorationMetrics({ runId, orgId, format, poolGenerated, finalCurated, totalMs, fallbackUsed })
recordPlatformMetrics({ format, complianceScore, violationCount })
recordCampaignMetrics({ campaignId, orgId, objective, formatCount, estimatedCredits })
recordQueueMetrics({ jobId, orgId, priority, outcome, durationMs, provider, costUsd, attempts })
```

### Diagnostics Dashboard (Admin)
- Engine health cards (healthy/degraded/critical)
- Live queue status (pending/running/failed counts + job table)
- Metrics table (all counters, gauges, histograms)
- Recent errors log with stage attribution

---

## 7. Stage Validation Layer

**File:** `src/engines/validation/stage-validator.ts`

Validates and repairs data at every inter-stage boundary:

```typescript
validateDesignGenome(raw): ValidationResult<DesignGenome>
validateEvaluationScores(raw): ValidationResult<EvaluationScores>
validatePipelineContext(raw): ValidationResult<ExplorePipelineContext>
validateExplorationPriors(raw): ValidationResult<ExplorationPriors>
validateFormat(format): ValidationResult<string>
```

### Auto-repair capabilities
- Invalid archetype → `"BOLD_CLAIM"`
- Invalid preset → `"bold"`
- Invalid hookStrategy → `"bold_headline"`
- Invalid compositionPattern → `"centered_axis"`
- Invalid densityProfile → `"balanced"`
- Out-of-range typographyPersonality → clamped to [0,4]
- Out-of-range scores → clamped to [0,1]
- NaN scores → defaulted to 0.5
- Unknown format → mapped to nearest or `"instagram_post"`

---

## 8. UX Improvements

### ExplorationPanel (`src/components/editor/ExplorationPanel.tsx`)
- **Progressive rendering** — animated progress bar while candidates are evaluated
- **Safe vs Experimental mode toggle** — controls pool size and HC ratio
- **Per-candidate score breakdown** — expandable score bars for all 6 dimensions
- **Novelty score display** — shows how novel each candidate is vs archive
- **Diversity cluster tabs** — separates high-confidence from experimental
- **Credit usage feedback** — clear indicator showing 0 or N credits
- **Adaptive temperature display** — shows exploration temperature converging

### Campaign Director UI (`src/components/dashboard/CampaignDirectorView.tsx`)
- Single-prompt input generates full multi-format campaign plan
- Visual identity display (colour swatches, tone, hook, composition)
- Format plan cards showing per-format headlines, archetypes, roles
- "Generate All Formats" button queues jobs to BullMQ

### DiagnosticsDashboard (`src/components/dashboard/DiagnosticsDashboard.tsx`)
- Engine health cards with status/latency/error rate
- Live queue monitoring
- Metrics inspector
- Recent error log

---

## 9. Database Migrations

**File:** `prisma/migrations/20260305_v9_full_platform/migration.sql`

New tables:
| Table | Purpose |
|-------|---------|
| `ExplorationPriors` | Per-org bandit weights for adaptive exploration |
| `ExplorationFeedback` | User interaction signals (selected, exported, etc.) |
| `NoveltyArchiveEntry` | Feature vectors for cross-session novelty search |
| `PlatformComplianceLog` | Platform compliance audit trail |
| `CampaignPlan` | Campaign Director plans |
| `RenderQueueRecord` | Queue metadata with priority/retry/cost tracking |
| `OrgSpendRecord` | Idempotent cost accumulation per org |
| `AssetLibraryEntry` | Org-specific asset usage tracking |

---

## 10. New API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/explore` | POST | Run creative exploration engine |
| `/api/explore/feedback` | POST/GET | Record feedback signals, load/update priors |
| `/api/platform` | GET | Get platform rules for a format |
| `/api/platform` | POST | Score a genome against platform rules |
| `/api/assets/library` | GET | List asset packs by industry |
| `/api/assets/library` | POST | Retrieve/generate assets intelligently |
| `/api/campaigns/director` | POST | Build campaign plan + optionally queue jobs |
| `/api/admin/diagnostics` | GET | Full engine health report |

---

## 11. Engine Barrel Export

All engines are now accessible via a single import:

```typescript
import {
  // Exploration
  runExploration, buildExploreInput, buildDefaultPriors, applyFeedback,
  // Platform
  getPlatformRules, scorePlatformCompliance,
  // Assets
  retrieveAssets, generateParametricBackground,
  // Campaign
  buildCampaignPlan, campaignFormatToGenerationPayload,
  // Queue
  buildRenderJobSpec, CostMonitor, ProviderHealthTracker, withTimeout,
  // Validation
  validateDesignGenome, validateEvaluationScores, validateFormat,
} from "../engines";
```

---

## Architecture Compatibility

All v9 additions:
- ✅ Preserve all v8 presets, archetypes, brand learning, GIF motion
- ✅ Extend the existing 8-stage pipeline — no stage removed or broken
- ✅ Use the same Prisma client, BullMQ queue, and logger infrastructure
- ✅ Follow the same idempotency + determinism contracts
- ✅ Never throw at engine boundaries — all errors produce fallback outputs
- ✅ All new routes use existing `withErrorHandling`, `getAuthUser`, and `planGate` middleware
