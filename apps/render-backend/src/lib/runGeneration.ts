// apps/render-backend/src/lib/runGeneration.ts
//
// Thin wrapper around the core generation pipeline.
//
// The heavy generation logic (OpenAI calls, template composition,
// asset injection, layout building, rendering) lives in
// apps/arkiol-core/src/lib/inlineGenerate.ts. We import it directly
// rather than copy it, so the Vercel frontend and this Render backend
// stay on a single code path that is tested in one place.
//
// On Vercel, runInlineGeneration is scheduled under Next's `after`
// primitive (apps/arkiol-core/src/lib/durableRun.ts). On Render it
// runs inside a long-lived Node process, so `after`/`waitUntil` are
// not needed — we just await the function directly on a detached
// promise (fire-and-forget relative to the inbound HTTP request; the
// Express handler returns 202 immediately and the frontend polls).
import {
  runInlineGeneration,
  type InlineGenerateParams,
} from '../../../arkiol-core/src/lib/inlineGenerate';

export type RenderGenerationParams = InlineGenerateParams;

/**
 * Start the heavy generation job in the background.
 *
 * Returns immediately after scheduling. Errors inside the pipeline
 * are caught and logged — the job row carries the authoritative
 * status, so the frontend sees failures via polling.
 */
export function scheduleRenderGeneration(params: RenderGenerationParams): void {
  // Force-tag workerMode so diagnostics make it clear the job ran on
  // the dedicated Render backend rather than a Vercel serverless
  // container or the inline fallback.
  const tagged: RenderGenerationParams = {
    ...params,
    workerMode: params.workerMode ?? ('render_backend' as any),
  };

  void (async () => {
    try {
      await runInlineGeneration(tagged);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error(
        `[render-backend] Generation threw for job ${tagged.jobId}:`,
        err?.message ?? err,
      );
    }
  })();
}
