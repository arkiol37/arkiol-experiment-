// src/lib/gallery-config.ts
// Gallery candidate-generation configuration.
//
// Step 21 centralizes how many candidate templates the real gallery flow
// tries to generate per prompt. Before this, the single-prompt API
// defaulted to 1 variation, so users landed on a gallery with no real
// choice. The gallery experience is meaningful only when the system
// explores a wider range of composition / styling options and presents a
// curated shortlist — this config is the knob that controls that volume.
//
// The final candidate count is always clamped by the org's per-run cap
// (plans.ts -> maxVariationsPerRun). That plan cap is the billing/quota
// boundary; GALLERY_DEFAULT_CANDIDATE_COUNT is the design intent for what
// a "good" single-prompt gallery looks like when the plan allows it.

// Target number of candidates the gallery flow should generate per prompt
// when the caller doesn't override it. Chosen to give the user a real
// shortlist (multiple layouts / compositions / styling picks) without
// over-spending on a single prompt. Plans with lower caps (e.g. free tier
// allowing 1 variation) still work — the plan gate clamps downstream.
export const GALLERY_DEFAULT_CANDIDATE_COUNT = 6;

// Hard ceiling we allow callers to request through the gallery API. This
// is the zod max on the /api/generate `variations` field. Higher than the
// previous cap (5) so top-tier plans can actually use their full
// maxVariationsPerRun budget (10 on founder / enterprise). Capped at 12
// to mirror packages/shared/src/policyRouter.ts which has the same limit
// at the inference-policy layer.
export const GALLERY_MAX_CANDIDATE_COUNT = 12;

// Minimum the user can request. 1 stays valid so any existing automation
// calling the API with variations=1 keeps working unchanged.
export const GALLERY_MIN_CANDIDATE_COUNT = 1;
