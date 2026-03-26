// src/lib/types.ts
// Arkiol canonical category & dimension registry.
// Nine practical categories — no social-platform-generic names.

// ── Canvas dimensions ─────────────────────────────────────────────────────────
export const FORMAT_DIMS: Record<string, { width: number; height: number }> = {
  instagram_post:     { width: 1080, height: 1080 },
  instagram_story:    { width: 1080, height: 1920 },
  youtube_thumbnail:  { width: 1280, height: 720  },
  flyer:              { width: 2550, height: 3300 },
  poster:             { width: 2480, height: 3508 },
  presentation_slide: { width: 1920, height: 1080 },
  business_card:      { width: 1050, height: 600  },
  resume:             { width: 2550, height: 3300 },
  logo:               { width: 1000, height: 1000 },
};

// ── Category types ────────────────────────────────────────────────────────────
export type ArkiolCategory =
  | "instagram_post" | "instagram_story" | "youtube_thumbnail"
  | "flyer" | "poster" | "presentation_slide"
  | "business_card" | "resume" | "logo";

export const ARKIOL_CATEGORIES: ArkiolCategory[] = [
  "instagram_post", "instagram_story", "youtube_thumbnail",
  "flyer", "poster", "presentation_slide",
  "business_card", "resume", "logo",
];

export const CATEGORY_LABELS: Record<ArkiolCategory, string> = {
  instagram_post:     "Instagram Post",
  instagram_story:    "Instagram Story",
  youtube_thumbnail:  "YouTube Thumbnail",
  flyer:              "Flyer",
  poster:             "Poster",
  presentation_slide: "Presentation Slide",
  business_card:      "Business Card",
  resume:             "Resume",
  logo:               "Logo",
};

export function getCategoryLabel(format: string): string {
  return CATEGORY_LABELS[format as ArkiolCategory] ?? format;
}

export function getCreditCost(format: string, includeGif: boolean): number {
  const heavyFormats = new Set(["flyer", "poster", "resume", "logo"]);
  const base = heavyFormats.has(format) ? 2 : 1;
  return includeGif ? base + 2 : base;
}

export interface ExportProfile {
  supportsSvg: boolean;
  supportsPng: boolean;
  supportsGif: boolean;
  defaultPngScale: number;
}

export const EXPORT_PROFILES: Record<ArkiolCategory, ExportProfile> = {
  instagram_post:     { supportsSvg: true,  supportsPng: true,  supportsGif: true,  defaultPngScale: 1 },
  instagram_story:    { supportsSvg: true,  supportsPng: true,  supportsGif: true,  defaultPngScale: 1 },
  youtube_thumbnail:  { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 1 },
  flyer:              { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 1 },
  poster:             { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 1 },
  presentation_slide: { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 1 },
  business_card:      { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 2 },
  resume:             { supportsSvg: false, supportsPng: true,  supportsGif: false, defaultPngScale: 1 },
  logo:               { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 2 },
};

// BUG-001 FIX: Single authoritative set of formats that actually produce GIF variants.
// Declared AFTER EXPORT_PROFILES to avoid a forward-reference error.
// Used by generate/route.ts (credit calculation) and generation.worker.ts (GIF gating).
export const GIF_ELIGIBLE_FORMATS: Set<string> = new Set(
  (Object.entries(EXPORT_PROFILES) as [ArkiolCategory, ExportProfile][])
    .filter(([, profile]) => profile.supportsGif)
    .map(([fmt]) => fmt)
);

export class ApiError extends Error {
  public statusCode: number;
  constructor(status: number, message: string) {
    super(message);
    this.name       = "ApiError";
    this.statusCode = status;
    (this as any).status = status;
  }
}
