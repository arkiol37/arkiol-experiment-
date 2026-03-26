// src/__tests__/v9-engines.test.ts
// Arkiol v9 Engine Test Suite
// ─────────────────────────────────────────────────────────────────────────────
// Tests all new v9 components:
//   • Platform Intelligence Engine
//   • Asset Library (retrieval, parametric gen)
//   • Campaign Creative Director
//   • Render Queue (priority, retry, cost monitor, safety)
//   • Stage Validator (genome, scores, context, format)
//   • Observability (metrics, tracing, diagnostics)
//   • Priors Persistence utilities

import { describe, it, expect, beforeEach } from "@jest/globals";

// ─────────────────────────────────────────────────────────────────────────────
// § 1  PLATFORM INTELLIGENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("Platform Intelligence Engine", () => {
  // @ts-ignore — jest resolves modules
  const { getPlatformRules, scorePlatformCompliance, getSupportedPlatforms, buildPlatformPromptContext } =
    require("../engines/platform/intelligence");

  it("returns rules for youtube_thumbnail", () => {
    const rules = getPlatformRules("youtube_thumbnail");
    expect(rules.platformId).toBe("youtube_thumbnail");
    expect(rules.dimensions.width).toBe(1280);
    expect(rules.dimensions.height).toBe(720);
    expect(rules.requiresHighContrast).toBe(true);
    expect(rules.textGuide.headlineMinPx).toBeGreaterThanOrEqual(60);
  });

  it("returns rules for instagram_story", () => {
    const rules = getPlatformRules("instagram_story");
    expect(rules.dimensions.width).toBe(1080);
    expect(rules.dimensions.height).toBe(1920);
    expect(rules.safeZone.bottom).toBeGreaterThan(0.15);
  });

  it("returns fallback rules for unknown format", () => {
    const rules = getPlatformRules("unknown_format_xyz");
    expect(rules).toBeTruthy();
    expect(rules.platformId).toBe("generic");
  });

  it("returns rules for ig_post alias", () => {
    const rules = getPlatformRules("ig_post");
    expect(rules.platformId).toBe("instagram_post");
  });

  it("scores platform compliance — bold_headline on youtube returns high hook score", () => {
    const genome = {
      layoutFamily: "yt_thumb", variationId: "v1_face_right",
      archetype: "BOLD_CLAIM", preset: "bold",
      typographyPersonality: 1, densityProfile: "balanced",
      hookStrategy: "bold_headline", compositionPattern: "rule_of_thirds",
      motionEligible: false,
    };
    const score = scorePlatformCompliance(genome as any, "youtube_thumbnail");
    expect(score.overall).toBeGreaterThan(0);
    expect(score.overall).toBeLessThanOrEqual(1);
    expect(score.hookEffectiveness).toBeGreaterThan(0.7);
  });

  it("scores dense content low on small-display context", () => {
    const genome = {
      layoutFamily: "yt_thumb", variationId: "v1", archetype: "BOLD_CLAIM",
      preset: "bold", typographyPersonality: 0, densityProfile: "dense",
      hookStrategy: "bold_headline", compositionPattern: "centered_axis",
      motionEligible: false,
    };
    const score = scorePlatformCompliance(genome as any, "youtube_thumbnail");
    expect(score.textLegibility).toBeLessThan(0.6);
    expect(score.violations.length).toBeGreaterThan(0);
  });

  it("returns non-empty platform list", () => {
    const platforms = getSupportedPlatforms();
    expect(platforms.length).toBeGreaterThan(8);
    expect(platforms).toContain("youtube_thumbnail");
    expect(platforms).toContain("instagram_post");
  });

  it("builds platform prompt context string", () => {
    const ctx = buildPlatformPromptContext("linkedin_post");
    expect(ctx).toContain("LinkedIn");
    expect(ctx).toContain("px");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 2  ASSET LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

describe("Asset Library", () => {
  const { retrieveAssets, listAssetPacks, getAssetPack, generateParametricBackground, buildRetrievalContext } =
    require("../engines/assets/asset-library");

  it("listAssetPacks returns at least 5 packs", () => {
    const packs = listAssetPacks();
    expect(packs.length).toBeGreaterThanOrEqual(5);
  });

  it("getAssetPack returns tech pack by packId", () => {
    const pack = getAssetPack("tech_core");
    expect(pack).toBeTruthy();
    expect(pack.industry).toBe("tech");
    expect(pack.assets.length).toBeGreaterThan(0);
  });

  it("getAssetPack returns undefined for unknown pack", () => {
    const pack = getAssetPack("nonexistent_pack_xyz");
    expect(pack).toBeUndefined();
  });

  it("retrieveAssets always returns at least 1 result", () => {
    const results = retrieveAssets({}, 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("retrieveAssets favours tech assets for tech context", () => {
    const results = retrieveAssets({
      industry: "tech",
      prefersDarkBg: true,
      toneKeywords: ["modern", "tech"],
    }, 3);
    expect(results.length).toBeGreaterThan(0);
    const hasTech = results.some(r => r.industry === "tech" || r.industry === "generic");
    expect(hasTech).toBe(true);
  });

  it("retrieveAssets respects dark background preference", () => {
    const results = retrieveAssets({ prefersDarkBg: true }, 5);
    const allCompatible = results.every(r => r.darkBgCompatible || r.industry === "generic");
    // At least some should be dark-bg compatible
    const hasCompatible = results.some(r => r.darkBgCompatible);
    expect(hasCompatible).toBe(true);
  });

  it("generateParametricBackground returns valid SVG string", () => {
    const svg = generateParametricBackground("test-seed-1", "#4f6ef7", "gradient");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("linearGradient");
  });

  it("generateParametricBackground is deterministic", () => {
    const svg1 = generateParametricBackground("seed-abc", "#ff0000", "dots");
    const svg2 = generateParametricBackground("seed-abc", "#ff0000", "dots");
    expect(svg1).toBe(svg2);
  });

  it("generateParametricBackground produces different output for different seeds", () => {
    const svg1 = generateParametricBackground("seed-001", "#4f6ef7", "geometric");
    const svg2 = generateParametricBackground("seed-002", "#4f6ef7", "geometric");
    expect(svg1).not.toBe(svg2);
  });

  it("buildRetrievalContext maps pipeline context correctly", () => {
    const ctx = buildRetrievalContext({
      intent: "test", format: "instagram_post",
      audienceSegment: "professionals", tonePreference: "modern",
      layoutType: "standard", brandPrimaryColor: "#4f6ef7",
      brandPrefersDarkBg: false, brandToneKeywords: ["tech"],
    });
    expect(ctx.primaryColor).toBe("#4f6ef7");
    expect(ctx.prefersDarkBg).toBe(false);
    expect(ctx.toneKeywords).toContain("tech");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 3  CAMPAIGN CREATIVE DIRECTOR
// ─────────────────────────────────────────────────────────────────────────────

describe("Campaign Creative Director", () => {
  const { buildCampaignPlan, campaignFormatToGenerationPayload } =
    require("../engines/campaign/creative-director");

  it("builds a valid plan from a minimal prompt", () => {
    const plan = buildCampaignPlan({ prompt: "Launch our new fitness tracking app" });
    expect(plan.campaignId).toBeTruthy();
    expect(plan.objective).toBeTruthy();
    expect(plan.identity).toBeTruthy();
    expect(plan.formats.length).toBeGreaterThan(0);
    expect(plan.estimatedCredits).toBeGreaterThan(0);
  });

  it("detects conversion objective from sales language", () => {
    const plan = buildCampaignPlan({ prompt: "Limited time offer! Buy our product now and save 40%" });
    expect(plan.objective).toBe("conversion");
  });

  it("detects announcement objective", () => {
    const plan = buildCampaignPlan({ prompt: "Announcing the launch of our brand new platform" });
    expect(plan.objective).toBe("announcement");
  });

  it("produces consistent identity across formats", () => {
    const plan = buildCampaignPlan({ prompt: "Premium luxury skincare brand awareness campaign" });
    expect(plan.identity.primaryColor).toBeTruthy();
    expect(plan.identity.accentColor).toBeTruthy();
    expect(plan.identity.headline).toBeTruthy();
    expect(plan.identity.ctaText).toBeTruthy();
  });

  it("respects brand primary color", () => {
    const plan = buildCampaignPlan({
      prompt: "Tech company awareness campaign",
      brandPrimaryColor: "#ff0000",
    });
    expect(plan.identity.primaryColor).toBe("#ff0000");
  });

  it("is deterministic for same seed", () => {
    const plan1 = buildCampaignPlan({ prompt: "Launch new product", seed: "abc123" });
    const plan2 = buildCampaignPlan({ prompt: "Launch new product", seed: "abc123" });
    expect(plan1.campaignId).toBe(plan2.campaignId);
    expect(plan1.objective).toBe(plan2.objective);
    expect(plan1.formats.length).toBe(plan2.formats.length);
  });

  it("uses requestedFormats when provided", () => {
    const formats = ["instagram_post", "youtube_thumbnail"];
    const plan = buildCampaignPlan({ prompt: "Brand awareness campaign targeting millennials", requestedFormats: formats });
    expect(plan.formats.map(f => f.format)).toEqual(formats);
  });

  it("assigns hero role to first format", () => {
    const plan = buildCampaignPlan({ prompt: "Product launch with high energy and urgency" });
    const heroFormats = plan.formats.filter(f => f.role === "hero");
    expect(heroFormats.length).toBeGreaterThan(0);
  });

  it("never throws on edge-case prompts", () => {
    const edgeCases = [
      "a", // Very short (below 10 chars but won't crash)
      "x".repeat(2000), // Max length
      "🚀 Unicode emoji campaign! 🎯",
      "<script>alert('xss')</script>",
    ];
    for (const prompt of edgeCases) {
      expect(() => buildCampaignPlan({ prompt })).not.toThrow();
    }
  });

  it("campaignFormatToGenerationPayload returns valid payload", () => {
    const plan = buildCampaignPlan({ prompt: "Test campaign for payload building" });
    const format = plan.formats[0];
    if (!format) return;

    const payload = campaignFormatToGenerationPayload(plan, format, "user-1", "org-1");
    expect(payload.prompt).toContain(plan.sharedPromptContext.slice(0, 20));
    expect(payload.formats).toEqual([format.format]);
    expect(payload.userId).toBe("user-1");
    expect(payload.orgId).toBe("org-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4  RENDER QUEUE
// ─────────────────────────────────────────────────────────────────────────────

describe("Render Queue Intelligence", () => {
  const {
    calculateRetryDelay, shouldRetry, buildProviderChain, ProviderHealthTracker,
    CostMonitor, computeJobSortKey, sortJobsByPriority, inferJobPriority,
    checkComputeSafety, buildRenderJobSpec, RenderTimeoutError, COMPUTE_LIMITS,
  } = require("../engines/queue/render-queue");

  it("calculateRetryDelay increases with attempt count", () => {
    const policy = { baseDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2.0, jitterFraction: 0, maxAttempts: 3 };
    const d0 = calculateRetryDelay(0, policy, "seed");
    const d1 = calculateRetryDelay(1, policy, "seed");
    const d2 = calculateRetryDelay(2, policy, "seed");
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it("calculateRetryDelay never exceeds maxDelayMs", () => {
    const policy = { baseDelayMs: 5000, maxDelayMs: 10000, backoffMultiplier: 10, jitterFraction: 0, maxAttempts: 5 };
    for (let i = 0; i < 8; i++) {
      const delay = calculateRetryDelay(i, policy, "seed");
      expect(delay).toBeLessThanOrEqual(10000);
    }
  });

  it("shouldRetry returns false when maxAttempts reached", () => {
    const job = buildRenderJobSpec({ jobId: "j1", orgId: "o1", userId: "u1", format: "instagram_post" });
    job.attempts = job.maxAttempts;
    expect(shouldRetry(job, "network error")).toBe(false);
  });

  it("shouldRetry returns false for kill switch errors", () => {
    const job = buildRenderJobSpec({ jobId: "j1", orgId: "o1", userId: "u1", format: "instagram_post" });
    job.attempts = 1;
    expect(shouldRetry(job, "kill_switch_active")).toBe(false);
    expect(shouldRetry(job, "credit_insufficient")).toBe(false);
  });

  it("shouldRetry returns true for network errors under max attempts", () => {
    const job = buildRenderJobSpec({ jobId: "j1", orgId: "o1", userId: "u1", format: "instagram_post" });
    job.attempts = 1;
    expect(shouldRetry(job, "network timeout")).toBe(true);
  });

  it("buildProviderChain returns ordered list starting with preferred", () => {
    const chain = buildProviderChain("openai");
    expect(chain[0]).toBe("openai");
    expect(chain.length).toBeGreaterThan(1);
  });

  it("buildProviderChain excludes specified providers", () => {
    const chain = buildProviderChain("openai", ["stability"]);
    expect(chain).not.toContain("stability");
  });

  describe("ProviderHealthTracker", () => {
    it("marks provider unhealthy after threshold failures", () => {
      const tracker = new ProviderHealthTracker();
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      expect(tracker.isHealthy("openai")).toBe(true); // below threshold
      tracker.recordFailure("openai");
      expect(tracker.isHealthy("openai")).toBe(false);
    });

    it("resets health on reset()", () => {
      const tracker = new ProviderHealthTracker();
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.recordFailure("openai");
      tracker.reset("openai");
      expect(tracker.isHealthy("openai")).toBe(true);
    });
  });

  describe("CostMonitor", () => {
    it("records costs and checks budget", () => {
      const monitor = new CostMonitor();
      monitor.record({
        orgId: "org1", jobId: "j1", provider: "openai",
        costUsd: 5.0, idempotencyKey: "ik1",
        timestamp: new Date().toISOString(),
      });
      const status = monitor.checkBudget("org1");
      expect(status.currentHourSpendUsd).toBe(5.0);
    });

    it("is idempotent for duplicate idempotency keys", () => {
      const monitor = new CostMonitor();
      const acc = { orgId: "org1", jobId: "j1", provider: "openai" as const, costUsd: 10.0, idempotencyKey: "ik-dup", timestamp: new Date().toISOString() };
      monitor.record(acc);
      monitor.record(acc); // duplicate
      const status = monitor.checkBudget("org1");
      expect(status.currentHourSpendUsd).toBe(10.0); // not 20
    });

    it("blocks when hourly limit exceeded", () => {
      const monitor = new CostMonitor();
      monitor.record({ orgId: "org2", jobId: "j1", provider: "openai", costUsd: 30.0, idempotencyKey: "ik-over", timestamp: new Date().toISOString() });
      const status = monitor.checkBudget("org2");
      expect(status.withinBudget).toBe(false);
    });
  });

  it("computeJobSortKey assigns higher key to critical priority", () => {
    const criticalJob = buildRenderJobSpec({ jobId: "c1", orgId: "o1", userId: "u1", format: "ig_post", priority: "critical" });
    const normalJob   = buildRenderJobSpec({ jobId: "n1", orgId: "o1", userId: "u1", format: "ig_post", priority: "normal" });
    expect(computeJobSortKey(criticalJob)).toBeGreaterThan(computeJobSortKey(normalJob));
  });

  it("sortJobsByPriority puts critical jobs first", () => {
    const jobs = [
      buildRenderJobSpec({ jobId: "low", orgId: "o1", userId: "u1", format: "ig_post", priority: "low" }),
      buildRenderJobSpec({ jobId: "crit", orgId: "o1", userId: "u1", format: "ig_post", priority: "critical" }),
      buildRenderJobSpec({ jobId: "norm", orgId: "o1", userId: "u1", format: "ig_post", priority: "normal" }),
    ];
    const sorted = sortJobsByPriority(jobs);
    expect(sorted[0].jobId).toBe("crit");
  });

  it("inferJobPriority returns critical for campaign hero", () => {
    const priority = inferJobPriority({ isCampaignHero: true, isCampaignJob: true, isRegen: false, isFirstGeneration: false });
    expect(priority).toBe("critical");
  });

  it("checkComputeSafety blocks when active job limit exceeded", () => {
    const monitor = new CostMonitor();
    const job = buildRenderJobSpec({ jobId: "j1", orgId: "o1", userId: "u1", format: "ig_post" });
    const result = checkComputeSafety(job, COMPUTE_LIMITS.maxConcurrentJobsPerOrg + 1, monitor);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("CONCURRENT_JOB_LIMIT");
  });

  it("RenderTimeoutError has correct code", () => {
    const err = new RenderTimeoutError("job-1", 5000);
    expect(err.code).toBe("RENDER_TIMEOUT");
    expect(err.jobId).toBe("job-1");
    expect(err.timeoutMs).toBe(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 5  STAGE VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

describe("Stage Validator", () => {
  const {
    validateDesignGenome, validateEvaluationScores,
    validatePipelineContext, validateExplorationPriors, validateFormat,
  } = require("../engines/validation/stage-validator");

  describe("validateDesignGenome", () => {
    const validGenome = {
      layoutFamily: "yt_thumb", variationId: "v1_face_right",
      archetype: "BOLD_CLAIM", preset: "bold",
      typographyPersonality: 1, densityProfile: "balanced",
      hookStrategy: "bold_headline", compositionPattern: "rule_of_thirds",
      motionEligible: false,
    };

    it("accepts valid genome", () => {
      const result = validateDesignGenome(validGenome);
      expect(result.valid).toBe(true);
      expect(result.data).toBeTruthy();
    });

    it("repairs invalid archetype", () => {
      const result = validateDesignGenome({ ...validGenome, archetype: "INVALID_ARCH" });
      expect(result.valid).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data?.archetype).toBe("BOLD_CLAIM");
    });

    it("repairs invalid preset", () => {
      const result = validateDesignGenome({ ...validGenome, preset: "not_a_preset" });
      expect(result.valid).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data?.preset).toBe("bold");
    });

    it("clamps typographyPersonality to [0,4]", () => {
      const result = validateDesignGenome({ ...validGenome, typographyPersonality: 7 });
      expect(result.valid).toBe(true);
      expect(result.data?.typographyPersonality).toBe(4);
    });

    it("fails for non-object input", () => {
      expect(validateDesignGenome(null).valid).toBe(false);
      expect(validateDesignGenome("string").valid).toBe(false);
      expect(validateDesignGenome(42).valid).toBe(false);
    });

    it("repairs invalid hookStrategy", () => {
      const result = validateDesignGenome({ ...validGenome, hookStrategy: "totally_fake" });
      expect(result.repaired).toBe(true);
      expect(result.data?.hookStrategy).toBe("bold_headline");
    });
  });

  describe("validateEvaluationScores", () => {
    const validScores = {
      readability: 0.8, visualHierarchyClarity: 0.75,
      platformOptimization: 0.9, brandAlignment: 0.7,
      visualBalance: 0.85, attentionPotential: 0.6,
      compositeScore: 0.77, weakestDimension: "attentionPotential",
      evaluationMs: 12,
    };

    it("accepts valid scores", () => {
      const result = validateEvaluationScores(validScores);
      expect(result.valid).toBe(true);
      expect(result.data?.compositeScore).toBeGreaterThan(0);
    });

    it("clamps out-of-range scores", () => {
      const result = validateEvaluationScores({ ...validScores, readability: 1.5 });
      expect(result.valid).toBe(true);
      expect(result.data?.readability).toBe(1.0);
      expect(result.repaired).toBe(true);
    });

    it("defaults NaN scores to 0.5", () => {
      const result = validateEvaluationScores({ ...validScores, brandAlignment: NaN });
      expect(result.valid).toBe(true);
      expect(result.data?.brandAlignment).toBe(0.5);
    });

    it("recomputes composite score from dimensions", () => {
      const allHigh = { ...validScores, readability: 1.0, visualHierarchyClarity: 1.0, platformOptimization: 1.0, brandAlignment: 1.0, visualBalance: 1.0, attentionPotential: 1.0 };
      const result = validateEvaluationScores(allHigh);
      expect(result.data?.compositeScore).toBeCloseTo(1.0, 1);
    });
  });

  describe("validatePipelineContext", () => {
    it("accepts valid context", () => {
      const result = validatePipelineContext({
        intent: "Create a bold YouTube thumbnail", format: "youtube_thumbnail",
        audienceSegment: "gamers", tonePreference: "energetic", layoutType: "face_right",
      });
      expect(result.valid).toBe(true);
    });

    it("fails without format", () => {
      const result = validatePipelineContext({ intent: "test", audienceSegment: "all" });
      expect(result.valid).toBe(false);
    });

    it("defaults missing optional fields", () => {
      const result = validatePipelineContext({ format: "ig_post" });
      expect(result.valid).toBe(true);
      expect(result.data?.intent).toBe("design");
      expect(result.data?.audienceSegment).toBe("general");
    });
  });

  describe("validateFormat", () => {
    it("accepts valid formats", () => {
      const formats = ["instagram_post", "youtube_thumbnail", "tiktok_ad", "linkedin_post"];
      for (const f of formats) {
        const result = validateFormat(f);
        expect(result.valid).toBe(true);
        expect(result.data).toBe(f);
      }
    });

    it("normalises aliases", () => {
      const result = validateFormat("ig_post");
      expect(result.valid).toBe(true);
      expect(result.data).toBe("ig_post");
    });

    it("normalises with hyphens and spaces", () => {
      const result = validateFormat("instagram-post");
      expect(result.valid).toBe(true);
    });

    it("falls back to instagram_post for unknown format", () => {
      const result = validateFormat("completely_unknown_xyz");
      expect(result.valid).toBe(true);
      expect(result.repaired).toBe(true);
      expect(result.data).toBe("instagram_post");
    });

    it("fails for non-string input", () => {
      expect(validateFormat(null).valid).toBe(false);
      expect(validateFormat(42).valid).toBe(false);
      expect(validateFormat("").valid).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 6  OBSERVABILITY
// ─────────────────────────────────────────────────────────────────────────────

describe("Observability", () => {
  const {
    metrics, obsLogger, TraceBuilder, buildCorrelationId,
    buildEngineHealthSnapshot, buildFullDiagnosticsReport,
    recordExplorationMetrics, recordCampaignMetrics,
  } = require("../lib/observability");

  it("metrics.increment never throws", () => {
    expect(() => {
      metrics.increment("test_counter", { label: "val" });
      metrics.increment("test_counter", { label: "val" });
    }).not.toThrow();
  });

  it("metrics.getCounter accumulates correctly", () => {
    metrics.increment("unique_counter_xyz", {}, 3);
    metrics.increment("unique_counter_xyz", {}, 2);
    expect(metrics.getCounter("unique_counter_xyz", {})).toBeGreaterThanOrEqual(5);
  });

  it("metrics.observe and getHistogramStats work", () => {
    metrics.observe("latency_test", 100);
    metrics.observe("latency_test", 200);
    metrics.observe("latency_test", 150);
    const stats = metrics.getHistogramStats("latency_test");
    expect(stats.count).toBeGreaterThanOrEqual(3);
    expect(stats.avg).toBeGreaterThan(0);
    expect(stats.min).toBeLessThanOrEqual(stats.max);
  });

  it("metrics.snapshot returns array of MetricSamples", () => {
    metrics.increment("snapshot_test_counter", { k: "v" });
    const snapshot = metrics.snapshot();
    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot.length).toBeGreaterThan(0);
  });

  it("obsLogger never throws", () => {
    expect(() => {
      obsLogger.info("test message", { jobId: "j1" });
      obsLogger.warn("warning", {});
      obsLogger.error("error", { stage: "test" });
    }).not.toThrow();
  });

  it("obsLogger.getRecentEntries returns entries", () => {
    obsLogger.error("observable test error", { stage: "v9-test" });
    const entries = obsLogger.getRecentEntries("error", 10);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("buildCorrelationId produces consistent output", () => {
    const id1 = buildCorrelationId("req", "job-1", "stage-1");
    const id2 = buildCorrelationId("req", "job-1", "stage-1");
    expect(id1).toBe(id2);
    expect(id1.length).toBe(16);
  });

  it("TraceBuilder builds spans and diagnostics", () => {
    const builder = new TraceBuilder("trace-test-1");
    const spanId = builder.startSpan("exploration", { format: "ig_post" });
    builder.endSpan(spanId, { ok: true, attributes: { outputSummary: "48 candidates" } });

    const diagnostic = builder.buildDiagnostic("run-test-1");
    expect(diagnostic.runId).toBe("run-test-1");
    expect(diagnostic.stages.length).toBe(1);
    expect(diagnostic.overallStatus).toBe("success");
    expect(diagnostic.fallbackCount).toBe(0);
  });

  it("TraceBuilder correctly marks fallback stages", () => {
    const builder = new TraceBuilder("trace-fallback-1");
    const spanId = builder.startSpan("constraint-repair", { fallback: true });
    builder.endSpan(spanId, { ok: true, attributes: { fallback: true, fallbackReason: "no valid candidates" } });

    const diagnostic = builder.buildDiagnostic("run-fb-1");
    expect(diagnostic.overallStatus).toBe("partial_fallback");
    expect(diagnostic.fallbackCount).toBe(1);
  });

  it("buildEngineHealthSnapshot returns valid snapshot", () => {
    const snapshot = buildEngineHealthSnapshot("exploration_engine");
    expect(snapshot.engineName).toBe("exploration_engine");
    expect(["healthy", "degraded", "critical"]).toContain(snapshot.status);
    expect(typeof snapshot.avgLatencyMs).toBe("number");
    expect(Array.isArray(snapshot.alerts)).toBe(true);
  });

  it("buildFullDiagnosticsReport returns system-level report", () => {
    const report = buildFullDiagnosticsReport();
    expect(report.timestamp).toBeTruthy();
    expect(report.engines.length).toBeGreaterThan(0);
    expect(Array.isArray(report.metrics)).toBe(true);
    expect(["healthy", "degraded", "critical"]).toContain(report.systemStatus);
  });

  it("recordExplorationMetrics does not throw", () => {
    expect(() => recordExplorationMetrics({
      runId: "r1", orgId: "o1", format: "ig_post",
      poolGenerated: 48, finalCurated: 12, totalMs: 340, fallbackUsed: false,
    })).not.toThrow();
  });

  it("recordCampaignMetrics does not throw", () => {
    expect(() => recordCampaignMetrics({
      campaignId: "c1", orgId: "o1", objective: "awareness",
      formatCount: 5, estimatedCredits: 12,
    })).not.toThrow();
  });
});
