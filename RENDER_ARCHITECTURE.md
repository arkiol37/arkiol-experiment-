# Arkiol — Render Architecture (v27)

## Overview

v27 enforces a strict **internal-only** rendering policy for all 2D and 2.5D output. The internal Template Execution Engine is the sole rendering path. External video providers (Runway, Pika, Sora) are completely disconnected from the active pipeline and preserved in `_future_3d/` for future 3D video capabilities only.

## Enforcement Stack

```
Request → renderQueue.ts (job processor)
            │
            ├── engineGate.ts ──── enforceInternalRendering()
            │     Blocks any provider engine request for 2D/2.5D modes.
            │     Unknown modes default to internal with warning.
            │     Future 3D modes throw (not yet implemented).
            │
            ├── hybridRouter.ts ── planJobRouting()
            │     Always returns strategy: 'all_internal'.
            │     Every scene routes to path: 'internal'.
            │     shouldUseInternalEngine() always returns true.
            │
            ├── promptCompilerEngine.ts ── compileAllPrompts()
            │     Compiles for target: 'internal' only.
            │     selectOptimalProvider() returns 'internal'.
            │     Single grammar profile (no provider-specific branches).
            │
            └── internalRenderPipeline.ts ── runInternalRender()
                  Template-driven rendering:
                  1. Bridge orchestrator output → SceneBindings
                  2. Render each scene → MP4 clip (sceneClipRenderer)
                  3. Stitch clips + transitions (FFmpeg)
                  4. Mix voice + music (FFmpeg)
                  5. Export aspect ratio variants
                  6. Upload to S3 → CDN URLs
```

## Intelligence Layers (preserved, active)

- **Psychology Layer** (`engines/psychology/`) — audience attention modeling
- **Quality Intelligence** (`engines/quality-intelligence/`) — automated quality scoring
- **Candidate Pipeline** (`engines/candidate/`) — multi-candidate generation and selection
- **Self-Healing** (`engines/self-healing/`) — failure classification, recovery, checkpointing
- **Intelligence Orchestrator** (`engines/orchestrator/`) — 27-stage pipeline coordination

## Isolated Provider Code

All external provider code lives in `backend/src/_future_3d/`:

```
_future_3d/
└── providers/
    ├── providerAdapter.ts      ← Runway/Pika/Sora API clients
    ├── providerStateStore.ts   ← Provider health tracking
    └── referenceChain.ts       ← Reference image chaining
```

These files are **not imported** by any active code path. The `providers/` directory in the main source tree contains only a README documenting the isolation.

## Supported Render Modes (2D/2.5D — internal only)

Normal Ad, Cinematic Ad, Standard Ad, UGC Style, Text-First, Product Focus, Brand Story, Minimalist, 2D Standard, 2D Extended, Premium Cinematic

## Future 3D Modes (not yet implemented)

3D Video, 3D Cinematic, Full 3D — these will use the provider adapter when implemented.
