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
  // Animation Studio + extended formats
  facebook_post:      { width: 1200, height: 630  },
  twitter_post:       { width: 1600, height: 900  },
  display_banner:     { width: 728,  height: 90   },
  linkedin_post:      { width: 1200, height: 627  },
  tiktok_video:       { width: 1080, height: 1920 },
};

// ── Category types ────────────────────────────────────────────────────────────
export type ArkiolCategory =
  | "instagram_post" | "instagram_story" | "youtube_thumbnail"
  | "flyer" | "poster" | "presentation_slide"
  | "business_card" | "resume" | "logo"
  | "facebook_post" | "twitter_post" | "display_banner"
  | "linkedin_post" | "tiktok_video";

export const ARKIOL_CATEGORIES: ArkiolCategory[] = [
  "instagram_post", "instagram_story", "youtube_thumbnail",
  "flyer", "poster", "presentation_slide",
  "business_card", "resume", "logo",
  "facebook_post", "twitter_post", "display_banner",
  "linkedin_post", "tiktok_video",
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
  facebook_post:      "Facebook Post",
  twitter_post:       "Twitter / X Post",
  display_banner:     "Display Banner",
  linkedin_post:      "LinkedIn Post",
  tiktok_video:       "TikTok Video",
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
  facebook_post:      { supportsSvg: true,  supportsPng: true,  supportsGif: true,  defaultPngScale: 1 },
  twitter_post:       { supportsSvg: true,  supportsPng: true,  supportsGif: true,  defaultPngScale: 1 },
  display_banner:     { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 1 },
  linkedin_post:      { supportsSvg: true,  supportsPng: true,  supportsGif: false, defaultPngScale: 1 },
  tiktok_video:       { supportsSvg: true,  supportsPng: true,  supportsGif: true,  defaultPngScale: 1 },
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
  public code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name       = "ApiError";
    this.statusCode = status;
    this.code       = code;
    (this as any).status = status;
  }
}
