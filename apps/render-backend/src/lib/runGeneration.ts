// apps/render-backend/src/lib/runGeneration.ts
//
// Thin wrapper around the framework-neutral generation pipeline.
//
// The pipeline implementation lives in
// `apps/arkiol-core/src/lib/inlineGenerate.ts` (and its sibling
// modules in `lib/` and `engines/`). Those files are
// **framework-neutral** — none of them import `server-only`,
// `next/server`, or any other Next.js-only module at the top
// level. That's enforced by the comments at the top of each file
// and verified before pushing.
//
// Next.js / Vercel-specific wrappers (durableRun, renderDispatch,
// the `/api/generate` route, NextRequest/NextResponse helpers)
// live in `apps/arkiol-core` only and are NOT imported here.
//
// On Render the heavy pipeline runs inside this long-lived Node
// process, so we don't need `next/after` or `@vercel/functions
// waitUntil` — we just await `runInlineGeneration` on a detached
// promise. The Express handler returns 202 immediately and the
// frontend polls /api/jobs (still served by Vercel) for status.
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
  // Tag workerMode so diagnostics make it clear the job ran on the
  // dedicated Render backend rather than a Vercel serverless
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
