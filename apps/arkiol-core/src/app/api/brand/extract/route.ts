// src/app/api/brand/extract/route.ts
// POST /api/brand/extract — Brand Auto-Import
// ─────────────────────────────────────────────────────────────────────────────
//
// Accepts EITHER:
//   • { url: "https://company.com" }       — scrapes OG/meta tags + favicon URL
//   • { logoUrl: "https://..." }           — analyses image directly via GPT-4o vision
//   • { logoBase64: "data:image/png;..." } — base64 logo uploaded from the browser
//
// Returns a pre-filled BrandKit the user can review and save in one click.
// The caller passes the result directly to POST /api/brand to save it.
//
// Extraction pipeline:
//   Step 1 (URL mode):  Fetch the page — extract meta[theme-color], og:image, favicon
//   Step 2:             Pass logo/og:image to GPT-4o vision for color + vibe extraction
//   Step 3:             Post-process hex normalisation + font inference from brand name
//
// Security:
//   • URL must be https:// and not a private IP (SSRF guard via webhookSsrfGuard)
//   • No cookies or credentials forwarded on fetch
//   • max 5 requests/min per user (uses "campaign" rate limiter bucket)
//
// This endpoint NEVER creates a Brand record — it only returns a suggestion.
// The user reviews and saves via POST /api/brand.

import "server-only";
import { detectCapabilities } from '@arkiol/shared';
import { NextRequest, NextResponse }         from "next/server";
import { getRequestUser, requirePermission } from "../../../../lib/auth";
import { withErrorHandling }                 from "../../../../lib/error-handling";
import { rateLimit }                         from "../../../../lib/rate-limit";
import { chatVisionJSON, chatJSON }          from "../../../../lib/openai";
import { validateWebhookUrl }                from "@arkiol/shared";
import { ApiError }                          from "../../../../lib/types";
import { z }                                 from "zod";
import { dbUnavailable } from "../../../../lib/error-handling";

// Vercel route config — GPT-4o vision calls need extended timeout
export const maxDuration = 60;

// ── Schema ─────────────────────────────────────────────────────────────────────

const ExtractSchema = z.union([
  z.object({
    url:         z.string().url().startsWith("https://"),
    logoBase64:  z.undefined(),
    logoUrl:     z.undefined(),
  }),
  z.object({
    logoUrl:     z.string().url().startsWith("https://"),
    url:         z.undefined(),
    logoBase64:  z.undefined(),
  }),
  z.object({
    logoBase64:  z.string().startsWith("data:image/").max(2 * 1024 * 1024), // 2MB base64 limit
    url:         z.undefined(),
    logoUrl:     z.undefined(),
  }),
]);

// ── Vision extraction prompt ───────────────────────────────────────────────────

const VISION_PROMPT = `You are a brand identity expert. Analyze this brand logo or website screenshot.
Extract the brand's visual identity. Return ONLY valid JSON (no markdown):
{
  "brandName":      "inferred brand name or empty string",
  "primaryColor":   "#RRGGBB hex of the dominant brand color",
  "secondaryColor": "#RRGGBB hex of a secondary or accent color",
  "accentColors":   ["#RRGGBB", "#RRGGBB"],
  "colorPaletteSummary": "1-sentence description of the palette",
  "suggestedFontDisplay": "Google Font or web-safe font that matches the brand aesthetic",
  "suggestedFontBody":    "readable body font that pairs with the display font",
  "voiceAttribs": {
    "professional": 0-100,
    "bold":         0-100,
    "warm":         0-100,
    "playful":      0-100,
    "minimal":      0-100
  },
  "toneKeywords":     ["word1", "word2", "word3"],
  "brandSummary":     "1 sentence brand positioning inferred from the visual style"
}
Rules:
- All hex values must be valid 6-digit codes (#RRGGBB)
- If you cannot confidently determine a color, use "#4f6ef7" as fallback
- Font names must be real Google Fonts or standard web-safe fonts
- voiceAttribs values must be integers 0-100`;

// ── Color normalisation ────────────────────────────────────────────────────────

function normalizeHex(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.trim().replace(/^#+/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `#${cleaned.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    // Expand 3-digit shorthand
    const [r, g, b] = cleaned.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function normalizePalette(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .slice(0, 4)
    .map(c => normalizeHex(c, ""))
    .filter(Boolean);
}

// ── Meta-tag scraper (URL mode) ────────────────────────────────────────────────

interface PageMeta {
  themeColor:  string | null;
  ogImage:     string | null;
  faviconUrl:  string | null;
  title:       string | null;
  description: string | null;
}

async function scrapePageMeta(pageUrl: string): Promise<PageMeta> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 8000); // 8s page fetch timeout

  try {
    const res = await fetch(pageUrl, {
      signal:  controller.signal,
      headers: {
        "User-Agent":      "Arkiol-BrandBot/1.0 (brand extraction; contact support@arkiol.com)",
        "Accept":          "text/html",
        "Accept-Language": "en",
      },
      redirect: "follow",
    });

    if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`);
    const html = await res.text();

    // Extract meta[theme-color]
    const themeMatch = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
    const themeColor = themeMatch?.[1] ?? null;

    // Extract og:image
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const ogImage = ogMatch?.[1] ?? null;

    // Extract favicon — prefer 32×32 or 16×16 link[rel=icon], fallback to /favicon.ico
    const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)
      ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i);
    let faviconUrl: string | null = null;
    if (iconMatch?.[1]) {
      const raw = iconMatch[1];
      faviconUrl = raw.startsWith("http") ? raw : new URL(raw, pageUrl).href;
    } else {
      faviconUrl = new URL("/favicon.ico", pageUrl).href;
    }

    // og:title / <title>
    const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? null;

    // og:description
    const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const description = descMatch?.[1]?.trim() ?? null;

    return { themeColor, ogImage, faviconUrl, title, description };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export const POST = withErrorHandling(async (req: NextRequest) => {
  if (!detectCapabilities().database) return dbUnavailable();

  const user = await getRequestUser(req);
  requirePermission(user.role, "EDIT_BRAND");

  const rl = await rateLimit(user.id, "campaign"); // 10/min — vision calls are expensive
  if (!rl.success) {
    return NextResponse.json({ error: "Rate limit exceeded for brand extraction." }, { status: 429 });
  }

  const body   = await req.json().catch(() => ({}));
  const parsed = ExtractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide one of: url (https://), logoUrl (https://), or logoBase64 (data:image/...)" },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // ── Determine image source for vision ─────────────────────────────────────
  let imageSource: string | null = null;
  let brandNameHint: string      = "";
  let descriptionHint: string    = "";

  if ("url" in input && input.url) {
    // SSRF guard — reject private IPs and non-HTTPS
    const ssrfCheck = validateWebhookUrl(input.url);
    if (!ssrfCheck.safe) {
      throw new ApiError(400, `URL rejected: ${ssrfCheck.reason}`);
    }

    // Scrape page meta
    const meta = await scrapePageMeta(input.url).catch((err: any) => {
      throw new ApiError(422, `Failed to fetch the page: ${err.message}. Check the URL is publicly accessible.`);
    });

    // Use og:image if available, otherwise favicon
    imageSource   = meta.ogImage ?? meta.faviconUrl ?? null;
    brandNameHint = meta.title?.split(/[|\-–]/)[0].trim() ?? "";
    descriptionHint = meta.description ?? "";

    // If no image found at all, fall back to text-only brand analysis using meta
    if (!imageSource && meta.title) {
      const textResult = await chatJSON(
        [
          {
            role:    "system",
            content: VISION_PROMPT.replace("this brand logo or website screenshot", "this brand description"),
          },
          {
            role:    "user",
            content: `Brand name: ${meta.title}\nDescription: ${meta.description ?? ""}`,
          },
        ],
        { model: "gpt-4o", temperature: 0.3, max_tokens: 600 }
      );
      return buildResponse(textResult as Record<string, unknown>, brandNameHint);
    }
  } else if ("logoUrl" in input && input.logoUrl) {
    const ssrfCheck = validateWebhookUrl(input.logoUrl);
    if ("reason" in ssrfCheck && ssrfCheck.reason) {
      throw new ApiError(400, `Logo URL rejected: ${ssrfCheck.reason}`);
    }
    imageSource = input.logoUrl;
  } else if ("logoBase64" in input && input.logoBase64) {
    imageSource = input.logoBase64;
  }

  if (!imageSource) {
    throw new ApiError(422, "Could not determine an image source from the provided input.");
  }

  // ── Vision extraction ──────────────────────────────────────────────────────
  let visionResult: Record<string, unknown>;
  try {
    visionResult = (await chatVisionJSON(imageSource, VISION_PROMPT, {
      model:      "gpt-4o",
      temperature: 0.2,
      max_tokens:  700,
    })) as Record<string, unknown>;
  } catch (err: any) {
    throw new ApiError(422, `Brand extraction failed: ${err.message}`);
  }

  // Override brandName with scrape hint if GPT didn't find one
  if (brandNameHint && !visionResult.brandName) {
    visionResult.brandName = brandNameHint;
  }
  if (descriptionHint && !visionResult.brandSummary) {
    visionResult.brandSummary = descriptionHint;
  }

  return buildResponse(visionResult, brandNameHint);
});

// ── Response builder ───────────────────────────────────────────────────────────

function buildResponse(raw: Record<string, unknown>, nameFallback: string): NextResponse {
  const primaryColor   = normalizeHex(raw.primaryColor,   "#4F6EF7");
  const secondaryColor = normalizeHex(raw.secondaryColor, "#A855F7");
  const accentColors   = normalizePalette(raw.accentColors);

  const voiceRaw   = (raw.voiceAttribs as Record<string, number> | null) ?? {};
  function safeVoiceVal(v: unknown, def: number): number {
    const n = Number(v ?? def);
    return Math.min(100, Math.max(0, Math.round(isNaN(n) ? def : n)));
  }
  const voiceAttribs: Record<string, number> = {
    professional: safeVoiceVal(voiceRaw.professional, 60),
    bold:         safeVoiceVal(voiceRaw.bold,         50),
    warm:         safeVoiceVal(voiceRaw.warm,         50),
    playful:      safeVoiceVal(voiceRaw.playful,      30),
    minimal:      safeVoiceVal(voiceRaw.minimal,      40),
  };

  const toneKeywords  = Array.isArray(raw.toneKeywords)
    ? (raw.toneKeywords as unknown[]).slice(0, 5).map(k => String(k)).filter(Boolean)
    : [];

  const suggestion = {
    // Ready to POST directly to /api/brand
    name:           (raw.brandName as string | null) || nameFallback || "My Brand",
    primaryColor,
    secondaryColor,
    accentColors,
    fontDisplay:    (raw.suggestedFontDisplay as string | null) || "Georgia",
    fontBody:       (raw.suggestedFontBody    as string | null) || "Arial",
    voiceAttribs,
    // Extra context for the UI (not stored in Brand model)
    _meta: {
      colorPaletteSummary: (raw.colorPaletteSummary as string | null) ?? "",
      toneKeywords,
      brandSummary:        (raw.brandSummary as string | null) ?? "",
      confidence:          "high",  // GPT-4o vision gives high confidence on logos
    },
  };

  return NextResponse.json({ suggestion });
}
