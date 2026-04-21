// Asset library — type definitions.
//
// The library is a curated, platform-authored catalog of design assets that
// can be looked up contextually and inserted into templates during generation.
// It is intentionally decoupled from the parametric runtime engine in
// `src/engines/assets/` which generates gradients/patterns on the fly.

export type AssetKind =
  | "icon"          // Small single-color or two-tone pictogram
  | "illustration"  // Multi-element decorative vector artwork
  | "photo"         // Raster photographic reference (URL)
  | "shape"         // Decorative vector shape (blob, burst, freeform accent)
  | "texture"       // Repeatable background pattern / surface
  | "sticker"       // Playful polychrome mini-graphic with its own palette
  | "badge"         // Emblem / seal — a labeled marker (NEW, SALE, circle tag)
  | "ribbon"        // Title ribbon / banner — for headers and callouts
  | "frame"         // Framed container — artwork that wraps a content block
  | "divider";      // Between-section ornamental separator

export type AssetCategory =
  | "productivity"
  | "wellness"
  | "education"
  | "business"
  | "fitness"
  | "beauty"
  | "travel"
  | "marketing"
  | "motivation";  // Step 34: 9th bucket — motivational / inspirational quotes,
                   // achievement, mindset, goal-setting content.

// Icon style axis (Step 34). Primary icons now come in outline + filled
// pairs so templates can choose a rendering that matches their visual
// weight. Stickers / badges / ribbons / etc. stay stylistically unitary
// and don't need a style axis — this field is optional.
export type AssetStyle = "outline" | "filled" | "duotone";

// Real-world subject axis (Step 35). Orthogonal to AssetCategory: a
// mountain photo has realm="nature" but extraCategories can place it
// under wellness / travel / motivation so category-driven selection
// surfaces it for the right briefs. Realms group photos / illustrations
// by *what the asset depicts*, not *what context it serves*.
//
//   nature       mountains, rivers, plants, sky, sunsets, forests
//   animal       dogs, cats, birds, wildlife
//   lifestyle    staged everyday scenes (desk setups, cozy rooms)
//   object       isolated everyday items (books, bottles, gym gear)
//   scene        wider atmospheric views (landscapes, cityscapes, rooms)
//   decorative   Step 54 — premium 3D structural / decorative units
//                (ribbons, badges, stickers, dividers, framed cards,
//                paper notes, checklist blocks, quote cards, labels,
//                banners, textures, patterned overlays). Used to
//                structure layouts and reinforce hierarchy, not as
//                incidental background art. Bucketed as its own realm
//                so selection can query "3D decorative kit" the same
//                way it queries "3D nature set".
//
// Icons and inline-SVG fallback art leave realm unset — they aren't
// part of a curated subject/realm catalog.
export type AssetRealm =
  | "nature"
  | "animal"
  | "lifestyle"
  | "object"
  | "scene"
  | "decorative";

// Visual-style axis (Step 36). Describes the *rendering style* of an
// asset independent of what it depicts — a mountain can be a photo, a
// 3D render, or a flat illustration. Enforcing style consistency at
// composition time (one style per template) is what turns a library
// into a coherent design system.
//
//   "3d"          Modern 3D render — clay / claymorphic / glassy.
//                 This is the platform's preferred hero style: modern,
//                 clean, high-resolution, consistent lighting + camera
//                 angle. When a 3D CDN is wired up (ARKIOL_3D_ASSET_BASE)
//                 selection pins to this style first.
//   "photo"       Real-world photograph
//   "illustration" Flat vector illustration (multiple colors)
//   "flat"        Single- or two-color flat icon
//   "outline"     Stroke-only outline icon
//   "hand-drawn"  Sketchy / doodle style
//
// When unset, the asset is style-agnostic and matches any style query.
export type AssetVisualStyle =
  | "3d"
  | "photo"
  | "illustration"
  | "flat"
  | "outline"
  | "hand-drawn";

// Step 47: quality tier axis. Orthogonal to visualStyle — describes how
// polished an individual asset is so the selector can prefer premium
// renders over lower-grade placeholders. 3D hero assets should ship as
// "premium" (high-resolution, consistent lighting, no mixed aesthetics).
// "standard" is acceptable for supporting decorative elements.
// "draft" is dev-only / placeholder — never surfaced in production templates.
//
// Left unset = "standard" for scoring purposes.
export type AssetQualityTier = "premium" | "standard" | "draft";

// How the asset's visual payload is delivered to a renderer.
export type AssetPayload =
  | { format: "svg";  markup: string }                                   // inline SVG
  | { format: "url";  url: string; width?: number; height?: number }     // external/CDN image
  | { format: "pattern"; svg: string; tileSize: number };                // repeatable SVG tile

export interface Asset {
  id:          string;
  kind:        AssetKind;
  // Primary category. Most assets are multi-homeable via `extraCategories`.
  category:    AssetCategory;
  // Optional secondary categories — allows an asset to surface in several
  // contextual buckets without duplication.
  extraCategories?: AssetCategory[];
  label:       string;
  // Free-form searchable tags (e.g. "calm", "minimal", "growth").
  tags:        string[];
  // Author-declared aspect ratio (w/h) — renderers may use this to reserve
  // layout space. Defaults to 1 for square.
  aspectRatio?: number;
  // Preferred fill/tint color when the renderer is free to choose. Optional.
  preferredColor?: string;
  // Visual weight of the asset — primarily used for icons (outline vs.
  // filled). Other kinds can leave it unset. See AssetStyle for values.
  style?:      AssetStyle;
  // Step 35: real-world subject axis. Present on photos / illustrations
  // that depict concrete real-world subjects (nature / animals /
  // lifestyle scenes / everyday objects / wider scenes). Left unset on
  // abstract / decorative assets.
  realm?:      AssetRealm;
  // Step 36: rendering-style axis. A mountain asset might be a photo,
  // a 3D render, or a flat illustration — visualStyle is what the
  // composition picks to enforce one-style-per-template consistency.
  // Left unset for style-agnostic assets (ribbons, badges, etc.).
  visualStyle?:AssetVisualStyle;
  // Step 47: quality tier. When unset, treated as "standard" by the
  // selector. Set to "premium" for curated hero-grade assets (3D
  // renders at manifest resolution, licensed photos). Templates
  // prefer premium picks for the primary visual and reject "draft"
  // tier entirely in production.
  qualityTier?:AssetQualityTier;
  payload:     AssetPayload;
}

// ── Query shape ───────────────────────────────────────────────────────────────

export interface AssetQuery {
  category?:    AssetCategory;
  kind?:        AssetKind;
  style?:       AssetStyle;          // outline / filled / duotone — icon-focused
  realm?:       AssetRealm;          // Step 35 — real-world subject filter
  visualStyle?: AssetVisualStyle;    // Step 36 — rendering-style filter
  qualityTier?: AssetQualityTier;    // Step 47 — minimum-tier filter
  tags?:        string[];            // match if the asset has ANY of these tags
  limit?:       number;
}
