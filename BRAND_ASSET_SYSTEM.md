[BRAND_ASSET_SYSTEM.md](https://github.com/user-attachments/files/26391666/BRAND_ASSET_SYSTEM.md)
# Brand Asset → 2D Ad Video Generation System
## Arkiol Platform v13 — Complete Implementation

---

## System Overview

The Brand Asset Library is a fully integrated, AI-powered system that transforms uploaded brand visuals (logos, product photos, screenshots, packaging) into animation-ready 2D ad elements that are automatically injected into scene templates.

---

## Architecture

```
User uploads brand asset
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                 UPLOAD PIPELINE                         │
│  POST /api/brand-assets/upload                          │
│  → Validate (mime, size, dimensions)                    │
│  → Upload original to S3                               │
│  → Create brand_assets DB record (status: pending)      │
│  → Fire-and-forget: processBrandAsset()                 │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              AI PROCESSING PIPELINE                     │
│  brandAssetProcessor.ts                                 │
│                                                         │
│  Stage 1: CLASSIFY   → Claude Vision API                │
│           logo | product | screenshot | packaging |     │
│           pattern | icon | other                        │
│                                                         │
│  Stage 2: BG_REMOVE  → Remove.bg API                    │
│           Skipped for: pattern, screenshot              │
│           Fallback: original PNG if API fails           │
│                                                         │
│  Stage 3: COLOR_EXTRACT → k-means palette extraction    │
│           Up to 8 dominant colors per asset             │
│                                                         │
│  Stage 4: ENHANCE    → Contrast + sharpening            │
│                                                         │
│  Stage 5: VECTORIZE  → SVG generation (logos/icons only)│
│           OPTIONAL — failure is non-fatal               │
│                                                         │
│  Stage 6: MOTION_INTEL → Assigns motion style           │
│           float | reveal | scale_in | slide_in | etc.  │
│                                                         │
│  → Update brand_assets: status=ready, all variant URLs  │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              SCENE PLACEMENT AI                         │
│  brandAssetSceneInjector.ts                             │
│                                                         │
│  resolveAssetSlotsForAd(assetIds, sceneRoles)           │
│                                                         │
│  Logo    → brand_reveal, cta, hook scenes               │
│  Product → hook, solution, offer, cta scenes            │
│  Screenshot → proof, solution scenes                    │
│  Packaging → hook, solution, offer, brand_reveal        │
│  Pattern → background slot in any scene                 │
│  Icon    → solution, proof, cta accent slot             │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              AD SCRIPT ENRICHMENT                       │
│  injectBrandAssetsIntoScript(adScript, assetIds)        │
│                                                         │
│  Each scene gains:                                      │
│  • assetLayers: [{cdnUrl, position, animation, zLayer}] │
│  • brandColors: {primary, secondary, accent, bg}        │
│  • layoutMode: asset_hero | supporting | brand_reveal   │
│  • enriched prompt with brand color context             │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              RENDER PIPELINE INTEGRATION                │
│  brandAssetRenderIntegration.ts                         │
│                                                         │
│  enrichScenesWithBrandAssets() called by renderQueue    │
│  → Injects asset overlay configs into each scene        │
│  → Generates FFmpeg compositing instructions            │
│  → Logo lockup in final frame enforced                  │
│  → Brand consistency validation post-render             │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│              EXPORT PIPELINE                            │
│  render_jobs now includes:                              │
│  • brand_asset_ids[]  — assets used                     │
│  • brand_palette      — color palette                   │
│  • asset_slots        — scene → asset mapping           │
│                                                         │
│  Export to: TikTok, Instagram, YouTube, Facebook        │
│  Full asset integration in all platform formats         │
└─────────────────────────────────────────────────────────┘
```

---

## Database Schema

### `brand_assets` (animation-studio Knex)
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workspace_id | UUID | → workspaces |
| brand_id | UUID | → brands (optional) |
| uploaded_by | UUID | → users |
| name | string | Display name |
| asset_type | string | logo/product/screenshot/packaging/pattern/icon/other |
| processing_status | string | pending/processing/ready/failed |
| cutout_cdn_url | string | Background-removed PNG URL |
| vector_cdn_url | string | SVG vector URL (optional) |
| enhanced_cdn_url | string | Enhanced image URL |
| extracted_palette | jsonb | Array of {hex, label, weight} |
| primary_color | string | Hex of dominant color |
| usage_role | string | logo_slot/product_slot/etc. |
| scene_placement_hints | jsonb | {suitableSceneRoles, position, scale, etc.} |
| recommended_motion | string | float/scale_in/reveal/etc. |
| pipeline_stages | jsonb | Per-stage results |

### `BrandUploadedAsset` (Prisma shared schema)
Full Prisma model synced with the above — allows arkiol-core (Next.js) to also
query brand assets through the unified Prisma client.

---

## API Endpoints

### Animation Studio (Express)
```
POST   /api/brand-assets/upload         Upload + enqueue AI processing
GET    /api/brand-assets                List assets (paginated, filtered)
GET    /api/brand-assets/:id            Single asset with processing result
PATCH  /api/brand-assets/:id/role       Override usage role
POST   /api/brand-assets/:id/reprocess  Re-run pipeline
DELETE /api/brand-assets/:id            Soft delete
GET    /api/brand-assets/palette/:ids   Merged palette for asset set
POST   /api/brand-assets/slots          Resolve scene → asset assignments
```

### Arkiol Core (Next.js)
```
GET    /api/brand-assets                List org's brand assets
PATCH  /api/brand-assets?id=X          Update role override
DELETE /api/brand-assets?id=X          Soft delete
```

---

## Frontend UI

### Animation Studio (`/brand-assets`)
- **BrandAssetLibraryPage.tsx**: Full drag-and-drop upload with:
  - Real-time processing status per asset
  - Type classification badges with confidence %
  - Extracted color palette display
  - Motion intelligence indicators
  - Scene placement hint display
  - Multi-select for palette extraction
  - Direct "Generate Ad" button with selected assets

### Studio Page (Step 5 — Brand Assets)
- New step inserted between "Script" and "Voice & Music"
- **BrandAssetPicker** component: grid of ready assets
- Auto-resolves scene slots when assets selected
- Shows brand palette and scene assignments
- Passes assetIds + palette to render job payload

### Arkiol Core (`/brand-assets`)
- **BrandAssetView.tsx**: Upload + manage assets
- Integrated into dashboard sidebar

---

## AI Processing Details

### Classification (Claude Vision)
Sends base64 image to `claude-opus-4-6` with structured JSON prompt.
Returns: type, confidence, hasText, hasTransparency, estimatedComplexity, brandSafety.
Fallback: heuristic classification from filename.

### Background Removal
Uses Remove.bg API (requires `REMOVE_BG_API_KEY` env var).
Fallback: returns original PNG with transparency detection from MIME type.
Skipped for: pattern, screenshot asset types.

### Color Extraction
Samples up to 5,000 pixels from image buffer.
Quantizes to 32-color buckets.
Returns up to 8 dominant colors with hex, RGB, weight, label.
Deduplicates by proximity when merging multi-asset palettes.

### Vectorization
Only for logo and icon types.
Wraps raster in SVG `<image>` element (production: integrate potrace or Vector.ai).
Non-fatal: failure falls back to cutout PNG seamlessly.

### Motion Intelligence
Deterministic mapping per asset type:
- Logo → reveal (1200ms cubic-bezier)
- Product → scale_in (800ms spring)
- Screenshot → slide_in (700ms ease)
- Packaging → float (4000ms ping-pong)
- Pattern → parallax (8000ms linear)
- Icon → bounce (1000ms elastic)

---

## Scene Placement Logic

Each asset type has a `ScenePlacementHints` object defining:
- `suitableSceneRoles`: which scenes it fits in
- `preferredSlot`: logo_slot | product_slot | etc.
- `dominanceLevel`: hero | supporting | accent
- `recommendedScalePercent`: 20-90% of canvas
- `preferredPosition`: center | left | right | etc.
- `zLayer`: background | midground | foreground

The `resolveAssetSlotsForAd()` function:
1. Iterates scene roles in order
2. Finds assets with matching placement hints
3. Prefers unused assets to avoid repetition
4. Falls back to reusing assets if needed
5. Returns `AssetSlotAssignment[]` with full render params

---

## Production Safeguards

1. **Validation**: MIME type allowlist, 50MB max, dimension check
2. **Storage quota**: Checked against workspace limit before upload
3. **Processing retries**: Max 3 attempts per asset
4. **Vectorization fallback**: Never blocks pipeline
5. **BG removal fallback**: Uses original if API fails
6. **Render fallback**: enrichScenesWithBrandAssets wraps in try/catch
7. **Soft delete**: Assets never hard-deleted, marked deleted_at
8. **Security**: All routes behind authenticate middleware
9. **Rate limiting**: uploadLimiter applied to /upload endpoint
10. **Color safety**: Extracted palette never crashes on empty pixels

---

## Environment Variables Required

```env
# Brand Asset Processing
REMOVE_BG_API_KEY=         # Remove.bg API key for background removal
ANTHROPIC_API_KEY=         # Claude Vision for asset classification

# Storage (already configured)
S3_BUCKET_ASSETS=          # S3 bucket for brand asset storage
CDN_URL=                   # CDN URL prefix
```

---

## Files Created/Modified

### New Files
- `backend/src/migrations/007_brand_asset_library.ts`
- `backend/src/services/brandAssetProcessor.ts`
- `backend/src/services/brandAssetSceneInjector.ts`
- `backend/src/services/brandAssetRenderIntegration.ts`
- `backend/src/routes/brandAssets.ts`
- `frontend/src/pages/BrandAssetLibraryPage.tsx`
- `packages/shared/prisma/migrations/20260308_brand_asset_library/migration.sql`
- `apps/arkiol-core/src/app/api/brand-assets/route.ts`
- `apps/arkiol-core/src/app/(dashboard)/brand-assets/page.tsx`
- `apps/arkiol-core/src/components/dashboard/BrandAssetView.tsx`

### Modified Files
- `backend/src/index.ts` — registered /api/brand-assets route
- `backend/src/jobs/renderQueue.ts` — brand asset enrichment hook
- `backend/src/services/storageService.ts` — added uploadBuffer()
- `frontend/src/lib/api.ts` — added brandAssetsApi
- `frontend/src/App.tsx` — added /brand-assets route
- `frontend/src/pages/StudioPage.tsx` — Step 5 brand assets
- `frontend/src/components/layout/AppLayout.tsx` — sidebar nav item
- `packages/shared/prisma/schema.prisma` — BrandUploadedAsset model
- `apps/arkiol-core/src/components/dashboard/SidebarLayout.tsx` — nav item
