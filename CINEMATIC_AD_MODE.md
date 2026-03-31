[CINEMATIC_AD_MODE.md](https://github.com/user-attachments/files/26391667/CINEMATIC_AD_MODE.md)
# Cinematic Ad Mode — Integration Verification

## Overview

This document verifies the full integration of the Cinematic Ad Mode into Arkiol Ads.
The implementation follows a strict **rendering-layer-only upgrade** philosophy:
no AI engines, script generators, or scene planners were modified.

---

## Architecture

```
Ad Script AI          ← UNCHANGED
  ↓
Scene Planning AI     ← UNCHANGED
  ↓
Brand Asset Engine    ← UNCHANGED
  ↓
Scene Composer        ← UNCHANGED (Hook, Problem, Solution, Proof, Brand Reveal, Offer, CTA)
  ↓
[NEW] Ad Style Router
  ├── Normal Ad → existing 2D Motion Renderer  (renderMode: 2D Standard / 2D Extended)
  └── Cinematic Ad → CinematicMotionRenderer   (renderMode: Premium Cinematic)
        ↓
        Scene Prompt Enrichment (depth cues, lighting, camera)
        ↓
        CinematicSceneDescriptor (layer stack, camera keyframes, asset treatment)
        ↓
[Existing] Video Provider (unchanged API)
  ↓
[Updated] stitchAndMixPipeline + extraVideoFilters
  ↓
[Existing] Export Pipeline (unchanged)
```

---

## Files Modified

### Backend

| File | Change | Impact |
|------|--------|--------|
| `backend/src/jobs/renderQueue.ts` | Added `adStyle` to `RenderConfig`, cinematic enrichment step, cinematic FFmpeg filter extraction | Additive only — normal mode fully unchanged |
| `backend/src/services/ffmpeg/ffmpegPipeline.ts` | Added optional `extraVideoFilters` to `StitchParams`, new step 6.5 | Additive — only runs when `extraVideoFilters` is provided |

### New Files

| File | Purpose |
|------|---------|
| `backend/src/services/cinematicMotionRenderer.ts` | Core cinematic rendering engine — depth layers, camera moves, typography motion, FFmpeg filters |
| `backend/tests/unit/cinematicMotionRenderer.test.ts` | 35+ unit tests covering all cinematic renderer components |
| `packages/shared/prisma/migrations/20260310_cinematic_ad_mode/migration.sql` | DB migration — `ad_style` column, cinematic descriptor storage |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/pages/StudioPage.tsx` | Added `adStyle` state, Ad Style selector UI (Normal/Cinematic cards), `effectiveRenderMode` derived state, updated cost calculation and config payload |

---

## Cinematic Motion Renderer — Capabilities

### 1. Multi-Layer Depth Composition (2.5D)

Seven depth layers with independent parallax velocity:

| Layer | Depth Z | Parallax | Blur | Use |
|-------|---------|----------|------|-----|
| `background` | 0 | 6% | 1.2px | Environment gradient/texture |
| `midground` | 1 | 14% | 0.4px | Supporting shapes/context |
| `subject` | 2 | 22% | 0px | Brand asset / product (sharp) |
| `headline` | 3 | 30% | 0px | Hero text |
| `supporting` | 4 | 32% | 0px | Body copy |
| `overlay` | 5 | 36% | 0px | Logo / CTA |
| `vignette` | 6 | 0% | 0px | Screen-fixed atmosphere |

### 2. Camera Movements

Six cinematic camera presets, assigned per scene role:

- **push_in** — gentle forward zoom (hook, offer)
- **pull_back** — dramatic zoom out (solution, close)
- **horizontal_drift** — slow lateral pan (proof)
- **ken_burns** — diagonal drift (problem)
- **rise_up** — subtle upward float (brand_reveal)
- **static_lock** — locked frame for text-heavy CTA

### 3. Scene Role → Cinematic Mapping

| Scene Role | Camera | Lighting | Overlay Effect |
|-----------|--------|----------|---------------|
| `hook` | Push In | Dramatic | Vignette |
| `problem` | Ken Burns | Soft Fill | None |
| `solution` | Pull Back | Studio | Lens Flare |
| `proof` | Horizontal Drift | Natural | None |
| `brand_reveal` | Rise Up | Backlit | Lens Flare |
| `offer` | Push In | Dramatic | Vignette |
| `cta` | Static Lock | Studio | None |

### 4. Brand Asset Treatment

Realistic brand assets with:
- **Clean depth placement** — hero_centered / hero_left / hero_right / full_depth / reveal_masked
- **Cinematic entrance** — opacity 0→1 with upward drift, cubic-bezier easing
- **Drop shadow** — `box-shadow: 0 12px 48px -8px rgba(0,0,0,0.35)`
- **Soft edge feather** — 8px edge softening for seamless depth integration
- **Exit fade** — graceful opacity 1→0 before scene cut

### 5. Typography Motion

Five premium motion presets:

| Preset | Enter Type | Use |
|--------|-----------|-----|
| `hook_headline` | Tracking In | Bold hook text |
| `solution_headline` | Word Stagger | Solution reveal |
| `proof_body` | Line Reveal | Testimonials/stats |
| `cta_display` | Mask Reveal | CTA finale |
| `brand_reveal` | Fade Up | Brand identity scenes |

### 6. FFmpeg Post-Processing (Cinematic Only)

Applied via `extraVideoFilters` in `stitchAndMixPipeline`:

- `vignette` — atmospheric depth vignette
- `noise=alls=3` — subtle film grain (professional, not VHS)
- `colorchannelmixer` — teal shadows / warm highlights color grade (16:9)
- `eq=contrast=1.04:saturation=1.08` — commercial contrast boost
- `unsharp=5:5:0.4` — broadcast-quality sharpness

---

## UI Integration

Step 3 (Creative) now presents an **Ad Style selector** with two visual cards:

**Normal Ad** ⚡
- Fast 2D motion graphics
- Standard layer animation
- Optimised for volume
- Uses 2D Standard or 2D Extended render mode

**Cinematic Ad** 🎬 `PREMIUM`
- 2.5D parallax depth layers
- Camera movement
- Depth-of-field blur
- Film color grade
- Atmospheric vignette & lens effects
- Uses Premium Cinematic render mode (14 cr/scene)

When Cinematic is selected, the Render Mode selector is replaced by a feature list.
Credits update in real-time to reflect Premium Cinematic pricing.

---

## Integration Verification Checklist

### Backward Compatibility
- [x] Normal Ad mode: `renderMode` defaults unchanged (2D Standard, 2D Extended)
- [x] Normal Ad: `isCinematicMode()` returns `false` → no cinematic enrichment runs
- [x] Normal Ad: `extraVideoFilters` is `undefined` → `stitchAndMixPipeline` step 6.5 skipped
- [x] Existing `enhancePrompt` function preserved (only adds cinematic block when mode detected)
- [x] `RenderConfig` interface is backward compatible — `adStyle` is optional

### Cinematic Mode Pipeline
- [x] `adStyle: 'cinematic'` passes through frontend → API → renderQueue correctly
- [x] Brand asset enrichment runs BEFORE cinematic enrichment (correct order)
- [x] Cinematic enrichment replaces scene prompts with depth-cued versions
- [x] `CinematicSceneDescriptor` attached to each enriched scene
- [x] FFmpeg filters extracted from descriptors and passed to `stitchAndMixPipeline`
- [x] Cinematic post-processing applied between subtitle burn and final encode

### Existing Pipeline Integration
- [x] Brand Asset Engine integration: `enrichScenesWithBrandAssets` → cinematic layer treats `assetLayers` correctly
- [x] `brandAssetSceneInjector`: `SceneAssetLayer` used as input to cinematic layer builder
- [x] Voice generation: unchanged, uses enriched `voiceoverScript` (not modified)
- [x] Music selection: unchanged
- [x] Subtitle generation: unchanged
- [x] Export pipeline (multi-format, platform): unchanged
- [x] Credit system: `effectiveRenderMode` resolves to `Premium Cinematic` for billing

### Graceful Degradation
- [x] Cinematic enrichment failure → `logger.warn` + continue with original scenes
- [x] Unknown scene role → falls back to `DEFAULT_CINEMATIC_CONFIG` (solution)
- [x] Missing `assetLayers` → skips asset layer construction, renders text/background only
- [x] Missing `onScreenText` → skips text layer (no crash)
- [x] Missing `brandColors` → uses neutral color prompt modifier

### Performance
- [x] Cinematic enrichment is CPU-only (no I/O, no AI calls)
- [x] FFmpeg step 6.5 uses `preset slow` + `crf 16` for maximum quality
- [x] Cinematic renders ~2.2× longer than normal (estimated) — documented in `AD_STYLE_CONFIGS`
- [x] Normal Ad renders: 0 overhead (cinematic code path not entered)

---

## Credit Pricing

| Ad Style | Render Mode | Credits/Scene | Base |
|----------|-------------|--------------|------|
| Normal | 2D Standard | 4 cr | Fast, volume |
| Normal | 2D Extended | 7 cr | Enhanced normal |
| Cinematic | Premium Cinematic | 14 cr | Premium visual quality |
| ~~removed~~ | ~~3D Brand Film~~ | ~~24 cr~~ | Not part of launch product |

---

## Platform Export Compatibility

Cinematic Ads export to all supported formats:
- TikTok (9:16, 1080×1920, H.264)
- Instagram Reels / Stories (9:16)
- Instagram Feed (1:1)
- YouTube In-Stream / Shorts (16:9 / 9:16)
- Facebook Feed / Reels (16:9 / 9:16)

The cinematic color grade uses `colorchannelmixer` only for 16:9 (broadcast) — 
vertical formats use standard `eq` only to preserve platform-native look.

---

## Launch Status: ✅ READY
