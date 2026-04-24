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
//       { prompt, jobId, userId, orgId, formats, variations,
//         stylePreset, includeGif, locale, brandId, campaignId,
//         archetypeOverride, expectedCreditCost }
//   → 202 { jobId, status, accepted: true, durability: "render_backend" }
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
  prompt:              string;
  jobId:               string;
  userId:              string;
  orgId:               string;
  formats:             string[];
  stylePreset:         string;
  variations:          number;
  brandId?:            string | null;
  campaignId?:         string | null;
  includeGif:          boolean;
  locale:              string;
  archetypeOverride?:  { archetypeId: string; presetId: string };
  expectedCreditCost:  number;
}

export interface RenderDispatchOk {
  ok:         true;
  status:     number;
  data:       unknown;
}

export interface RenderDispatchErr {
  ok:         false;
  status?:    number;
  error:      string;
}

export type RenderDispatchResult = RenderDispatchOk | RenderDispatchErr;

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
      const message =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : undefined) ??
        `Render backend returned ${resp.status}`;
      return { ok: false, status: resp.status, error: message };
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
