# Arkiol v27 — Internal-Only Rendering Architecture

## Overview

v27 completes the architectural shift started in v26 by making the **Template Execution Engine (TEE)** the **sole and enforced rendering path** for all 2D and 2.5D outputs. External provider APIs (Runway, Pika, Sora, etc.) are **completely removed** from the 2D/2.5D pipeline and reserved exclusively for future 3D video capabilities.

The **19-stage orchestrator, worker system, and FFmpeg assembly/export pipeline remain stable and unchanged** in their core contracts.

---

## V27 Key Principles

1. **Internal-Only**: Every 2D/2.5D scene is rendered by the TEE. No external provider fallback exists.
2. **Spec-First**: The Integration Bridge produces a strict validated `RenderSpecCollection` as single source of truth. Rendering cannot proceed without resolved layout, safe areas, and bindings.
3. **Blocking Validation**: Critical spec/QC errors halt the pipeline. Auto-correctable issues are fixed in-place.
4. **Commercial Quality**: Anti-aliased typography, precise layering, smooth motion, deterministic output, brand safety.
5. **GIF Parity**: GIF output fully wired into final result structure.

---

## Architecture Diagram

```
Intelligence Orchestrator (19 stages, unchanged)
         │ PipelineContext
         ▼
Internal Engine Gate (v27) — BLOCKS external provider for 2D/2.5D
         │
         ▼
Spec Builder + Blocking Validation — SceneSpec[] (strict, validated)
         │
         ▼
Template Execution Engine (sole rendering path)
  ├── Layout/Constraint Engine (blocking validation, auto-correct)
  ├── Asset Pipeline (multi-tier fallback, memory-bounded)
  ├── Animation Timeline (audio-sync triggers, sub-frame interpolation)
  ├── Frame Renderer (enhanced anti-aliasing, gradient, shadow)
  ├── Scene Clip Renderer (timeout/retry, backpressure, GIF wired)
  └── Scene QC Validator (blocking critical, auto-correct)
         │ SceneClipResult[] (normalized)
         ▼
FFmpeg Assembly Layer (unchanged)
```

---

## Changes Summary

### Removed
- ProviderAdapter never called for 2D/2.5D
- Provider fallback path in renderQueue.ts eliminated
- Duplicate orchestrator call removed
- HybridRouter replaced with internal-only enforcement gate

### Upgraded
- renderQueue.ts: unified internal-only path, GIF wired, blocking spec validation
- constraintEngine.ts: auto-correct, enhanced shrink-to-fit, overlap resolution
- frameRenderer.ts: enhanced anti-aliasing, gradient, shadow, deterministic compositing
- sceneClipRenderer.ts: timeout/retry, backpressure, encoding validation
- assetPipeline.ts: multi-tier fallback, memory-pressure eviction
- sceneQCValidator.ts: blocking critical, auto-correct text/contrast/safe-area
- animationTimeline.ts: audio-sync triggers, motion blur hint
- internalRenderPipeline.ts: GIF in result, thumbnail from internal frame

### New
- engines/renderer/engineGate.ts — enforcement gate blocking external providers

---

## No new dependencies. All changes use existing Sharp + FFmpeg stack.
