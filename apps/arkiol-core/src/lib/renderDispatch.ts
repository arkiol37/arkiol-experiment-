// apps/arkiol-core/src/lib/renderDispatch.ts
//
// Dispatch the generation request to the Render backend.
//
// Env:
//   RENDER_BACKEND_URL     — base URL of the Render Node service
//                            (no trailing slash). REQUIRED.
//   RENDER_GENERATION_KEY  — shared secret sent as
//                            `Authorization: Bearer <key>`. REQUIRED.
//
// Contract with the backend:
//   POST <RENDER_BACKEND_URL>/generate
//     headers:
//       Authorization: Bearer <RENDER_GENERATION_KEY>
//       Content-Type:  application/json
//     body:
//       { prompt, jobId, userId, orgId, formats, format,
//         stylePreset, style, variations, brandId, campaignId,
//         includeGif, locale, archetype, archetypeOverride,
//         expectedCreditCost, hqUpgrade, youtubeThumbnailMode }
//   → 202 { jobId, status, accepted: true, durability: "render_backend" }
//
// On error the helper extracts BOTH `error` and `details` from
// Render's JSON response so the caller can surface field-level
// validation failures to the UI rather than the generic
// "Invalid request" string.
//
// The Vercel route is a thin pass-through — it does NOT await the
// heavy pipeline. The backend responds immediately after scheduling
// the job in the background; the frontend polls /api/jobs for status.
import "server-only";

export function isRenderBackendConfigured(): boolean {
  const url = process.env.RENDER_BACKEND_URL?.trim();
  const key = process.env.RENDER_GENERATION_KEY?.trim();
  return !!(url && key);
}

export interface RenderDispatchPayload {
  jobId:               string;
  userId:              string;
  orgId:               string;
  prompt:              string;
  /** Multi-format array (canonical). */
  formats:             string[];
  /** Singular alias of `formats[0]` — for any backend reader that
   *  expects "format" instead of "formats". Always populated when
   *  `formats` is non-empty. */
  format?:             string;
  /** Style preset (e.g. "auto", "minimal"). Sent as both
   *  `stylePreset` and `style` aliases. */
  stylePreset:         string;
  style?:              string;
  variations:          number;
  brandId?:            string | null;
  campaignId?:         string | null;
  includeGif:          boolean;
  /** Animation flag alias. The backend's pipeline reads
   *  `includeGif`; some readers may look for `animation`. */
  animation?:          boolean;
  locale:              string;
  /** Archetype id (e.g. "auto"). Sent as both top-level
   *  `archetype` and as `archetypeOverride.archetypeId`. */
  archetype?:          string;
  archetypeOverride?:  { archetypeId: string; presetId: string };
  expectedCreditCost:  number;
  hqUpgrade?:          boolean;
  youtubeThumbnailMode?: string;
}

export interface RenderDispatchOk {
  ok:         true;
  status:     number;
  data:       unknown;
}

export interface RenderDispatchErr {
  ok:         false;
  status?:    number;
  /** Short human-readable error message (e.g. "Invalid generation payload"). */
  error:      string;
  /** Detailed validation breakdown — Render returns this as
   *  `details: parsed.error.flatten()` from its Zod schema. We
   *  forward it so the UI can show field-level reasons. */
  details?:   unknown;
}

export type RenderDispatchResult = RenderDispatchOk | RenderDispatchErr;

/** Build the dispatch payload from the validated frontend input.
 *
 *  Centralising this makes it easy to keep Vercel + Render in sync
 *  and ensures every field the backend's Zod schema requires is
 *  always present, even when the frontend omits it.
 */
export function buildRenderPayload(args: {
  jobId:                string;
  userId:               string;
  orgId:                string;
  prompt:               string;
  formats:              string[];
  stylePreset:          string;
  variations:           number;
  brandId?:             string | null;
  campaignId?:          string | null;
  includeGif:           boolean;
  locale:               string;
  archetypeOverride?:   { archetypeId: string; presetId: string };
  expectedCreditCost:   number;
  hqUpgrade?:           boolean;
  youtubeThumbnailMode?: string;
}): RenderDispatchPayload {
  const archetypeId =
    args.archetypeOverride?.archetypeId?.trim() || "auto";
  const presetId =
    args.archetypeOverride?.presetId?.trim() || "auto";

  return {
    jobId:                args.jobId,
    userId:               args.userId,
    orgId:                args.orgId,
    prompt:               args.prompt,
    formats:              args.formats,
    format:               args.formats[0],
    stylePreset:          args.stylePreset,
    style:                args.stylePreset,
    variations:           args.variations,
    brandId:              args.brandId ?? null,
    campaignId:           args.campaignId ?? null,
    includeGif:           args.includeGif,
    animation:            args.includeGif,
    locale:               args.locale,
    archetype:            archetypeId,
    archetypeOverride:    { archetypeId, presetId },
    expectedCreditCost:   args.expectedCreditCost,
    hqUpgrade:            args.hqUpgrade ?? false,
    youtubeThumbnailMode: args.youtubeThumbnailMode ?? "auto",
  };
}

/**
 * POST to the Render backend's /generate endpoint.
 *
 * Returns the backend's JSON response on success so the caller can
 * forward it to the frontend verbatim. Short timeout (10s) — the
 * backend schedules work in the background and should respond fast.
 */
export async function dispatchToRenderBackend(
  payload: RenderDispatchPayload,
): Promise<RenderDispatchResult> {
  const url = process.env.RENDER_BACKEND_URL?.trim();
  const key = process.env.RENDER_GENERATION_KEY?.trim();
  if (!url || !key) {
    return { ok: false, error: "RENDER_BACKEND_URL / RENDER_GENERATION_KEY not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await fetch(`${url.replace(/\/$/, "")}/generate`, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
    });

    let parsed: unknown = null;
    try {
      parsed = await resp.json();
    } catch {
      const text = await resp.text().catch(() => "");
      parsed = text ? { raw: text } : null;
    }

    if (!resp.ok) {
      const obj = parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
      const message =
        (obj && typeof obj.error === "string" ? obj.error : undefined) ??
        `Render backend returned ${resp.status}`;
      const details = obj?.details ?? obj?.raw ?? undefined;
      return {
        ok:      false,
        status:  resp.status,
        error:   message,
        details,
      };
    }

    return { ok: true, status: resp.status, data: parsed };
  } catch (err: any) {
    return {
      ok:    false,
      error: err?.name === "AbortError"
        ? "Render backend timed out"
        : (err?.message ?? String(err)),
    };
  } finally {
    clearTimeout(timeout);
  }
}
