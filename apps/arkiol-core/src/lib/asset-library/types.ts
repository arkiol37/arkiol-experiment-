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
//   nature     mountains, rivers, plants, sky, sunsets, forests
//   animal     dogs, cats, birds, wildlife
//   lifestyle  staged everyday scenes (desk setups, cozy rooms)
//   object     isolated everyday items (books, bottles, gym gear)
//   scene      wider atmospheric views (landscapes, cityscapes, rooms)
//
// Abstract / decorative assets (ribbons, badges, icons, textures) leave
// realm unset — they aren't "real-world" depictions.
export type AssetRealm =
  | "nature"
  | "animal"
  | "lifestyle"
  | "object"
  | "scene";

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
  payload:     AssetPayload;
}

// ── Query shape ───────────────────────────────────────────────────────────────

export interface AssetQuery {
  category?: AssetCategory;
  kind?:     AssetKind;
  style?:    AssetStyle;     // outline / filled / duotone — icon-focused
  realm?:    AssetRealm;     // Step 35 — real-world subject filter
  tags?:     string[];       // match if the asset has ANY of these tags
  limit?:    number;
}
