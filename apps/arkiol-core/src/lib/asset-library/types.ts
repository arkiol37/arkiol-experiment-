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
  | "marketing";

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
  payload:     AssetPayload;
}

// ── Query shape ───────────────────────────────────────────────────────────────

export interface AssetQuery {
  category?: AssetCategory;
  kind?:     AssetKind;
  tags?:     string[];       // match if the asset has ANY of these tags
  limit?:    number;
}
