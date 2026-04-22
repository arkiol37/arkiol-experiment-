// apps/arkiol-core/src/lib/renderDispatch.ts
//
// Dispatch to the dedicated Render generation backend.
//
// When the operator sets RENDER_GENERATION_URL (+ RENDER_GENERATION_KEY)
// as environment variables on Vercel, /api/generate forwards the heavy
// pipeline over HTTP to the Render service instead of running
// `runInlineGeneration` under Vercel's `waitUntil`. This fulfills the
// "Vercel = UI + thin API, Render = heavy generation" split without
// changing the DB-backed job flow or the frontend polling contract.
//
// Failure handling: if the Render service is unreachable or rejects
// the request, we return `{ok:false}` so the caller can fall back to
// the inline durable path. Generation MUST continue to work on
// preview / local deploys where the Render URL isn't configured.
import "server-only";

/** Truthy only when both env vars are set to non-empty strings. */
export function isRenderBackendConfigured(): boolean {
  const url = process.env.RENDER_GENERATION_URL?.trim();
  const key = process.env.RENDER_GENERATION_KEY?.trim();
  return !!(url && key);
}

export interface RenderDispatchPayload {
  jobId:              string;
  userId:             string;
  orgId:              string;
  prompt:             string;
  formats:            string[];
  stylePreset:        string;
  variations:         number;
  brandId?:           string | null;
  campaignId?:        string | null;
  includeGif:         boolean;
  locale:             string;
  archetypeOverride?: { archetypeId: string; presetId: string };
  expectedCreditCost: number;
}

export interface RenderDispatchResult {
  ok: boolean;
  /** HTTP status from the Render service, when we got one. */
  status?: number;
  /** Present when the Render service reached successfully. */
  durability?: "render_backend";
  /** Present on failure — short human message for diagnostics. */
  error?: string;
}

/**
 * Fire a POST to the Render backend's /generate endpoint.
 *
 * This call is fast (just asks Render to start the job) but we wrap
 * it in a short timeout so a slow/unavailable Render service can't
 * block the Vercel response — the caller has the inline durable
 * path as a fallback.
 */
export async function dispatchToRenderBackend(
  payload: RenderDispatchPayload,
): Promise<RenderDispatchResult> {
  const url = process.env.RENDER_GENERATION_URL?.trim();
  const key = process.env.RENDER_GENERATION_KEY?.trim();
  if (!url || !key) {
    return { ok: false, error: "RENDER_GENERATION_URL not configured" };
  }

  // 8s is generous for a "start the job" call — the heavy work runs
  // afterwards, fully detached from this HTTP round-trip.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const resp = await fetch(`${url.replace(/\/$/, "")}/generate`, {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "content-type":         "application/json",
        "x-arkiol-render-key":  key,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      let detail = "";
      try {
        detail = (await resp.text()).slice(0, 500);
      } catch { /* non-fatal */ }
      return {
        ok:     false,
        status: resp.status,
        error:  `Render backend returned ${resp.status}: ${detail}`,
      };
    }

    return { ok: true, status: resp.status, durability: "render_backend" };
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
