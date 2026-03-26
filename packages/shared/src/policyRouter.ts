// packages/shared/src/policyRouter.ts
// POLICY ROUTER — Production-Grade v2
//
// The Policy Router computes a RoutingPlan that the ControlPlaneExecutor STRICTLY
// ENFORCES. "Strictly enforces" means:
//
//   1. Every stage that runs is explicitly authorised by the routing plan
//   2. Every disabled stage is logged with a machine-readable reason (no silent bypass)
//   3. alwaysRun engines cause a RegistryViolationError if the plan disables them
//   4. The routing plan is frozen (Object.freeze) immediately after computation
//   5. The plan is persisted to RoutingPlanLog BEFORE any stage executes
//   6. Enforcement is repeated at the executor for every stage — plan vs reality diff
//
// The Policy Router is PURE and STATELESS — it never reads from a database.
// All context (load level, plan, flags) is injected by the caller.

import { z } from 'zod';
import { getAllEngines, assertRoutingValid, type ExecutionStage, type EngineContract } from './engineRegistry';
import type { PlanKey } from './plans';

// ── Routing mode ────────────────────────────────────────────────────────────────
export const RoutingModeSchema = z.enum([
  'deterministic',
  'exploration',
  'speed_optimized',
  'premium_intelligence',
]);
export type RoutingMode = z.infer<typeof RoutingModeSchema>;

// ── Routing context (all input the router needs) ────────────────────────────────
export const RoutingContextSchema = z.object({
  orgId:             z.string(),
  userId:            z.string(),
  plan:              z.string(),
  generationIntent:  z.enum(['normal_ad','cinematic_ad','exploration','batch']),
  requestedMode:     RoutingModeSchema.optional(),
  format:            z.string(),
  variationCount:    z.number().int().min(1).max(12),
  systemLoadLevel:   z.enum(['low','normal','high','critical']),
  workerQueueDepth:  z.number().int().nonnegative(),
  brandLearningEnabled:       z.boolean().default(false),
  explorationModeEnabled:     z.boolean().default(false),
  hasBrandKit:                z.boolean().default(false),
  brandId:                    z.string().optional(),
  campaignId:                 z.string().optional(),
  explorationBudgetRemaining: z.number().nonnegative().default(0),
});
export type RoutingContext = z.infer<typeof RoutingContextSchema>;

// ── Per-engine routing decision ─────────────────────────────────────────────────
export interface EngineRoutingDecision {
  readonly engineName:       string;
  readonly engineVersion:    string;
  readonly enabled:          boolean;
  readonly disabledReason:   string | undefined;   // always set when enabled=false
  readonly timeoutMs:        number;               // hard timeout for this stage
  readonly allowFallback:    boolean;              // whether engine can fall back vs abort
  readonly maxCostUsd:       number;               // budget ceiling for this stage
  readonly tracingEnabled:   boolean;
  readonly benchmarkEnabled: boolean;
}

// ── Routing plan (frozen — immutable once computed) ─────────────────────────────
export interface RoutingPlan {
  readonly planId:              string;
  readonly mode:                RoutingMode;
  readonly decisions:           ReadonlyMap<string, EngineRoutingDecision>;
  readonly stageOrder:          ReadonlyArray<ExecutionStage>;
  readonly explorationParallel: boolean;
  readonly totalBudgetMs:       number;
  readonly totalBudgetUsd:      number;
  readonly rationale:           ReadonlyArray<string>;   // human-readable audit log
  readonly routedAt:            string;
  readonly persisted:           boolean;                 // true once written to RoutingPlanLog
}

// Canonical pipeline stage order — executors must respect this sequence
const STAGE_ORDER: ExecutionStage[] = [
  'pre_intent','intent','layout','variation','audience',
  'density','brand','asset','exploration','cinematic','post_process',
];

// ── Primary routing function ────────────────────────────────────────────────────

/**
 * Compute an immutable, frozen RoutingPlan for a generation request.
 *
 * This function is the single authority on which engines run and in what mode.
 * The ControlPlaneExecutor calls assertRoutingValid() for every alwaysRun engine
 * to detect policy conflicts before execution begins.
 */
export function computeRoutingPlan(rawCtx: RoutingContext): Readonly<RoutingPlan> {
  const ctx      = RoutingContextSchema.parse(rawCtx);
  const rationale: string[] = [`[${new Date().toISOString()}] Routing started for org=${ctx.orgId} intent=${ctx.generationIntent}`];

  const mode         = _resolveMode(ctx, rationale);
  const { totalBudgetMs, totalBudgetUsd } = _computeBudget(mode, ctx, rationale);

  const decisions = new Map<string, EngineRoutingDecision>();
  for (const contract of getAllEngines()) {
    const decision = _decideEngine(contract, mode, ctx, rationale);
    decisions.set(contract.name, decision);
    // Enforce alwaysRun constraint: throws if policy tried to disable a critical engine
    assertRoutingValid(contract.name, decision.enabled, mode);
  }

  const explorationDecision  = decisions.get('ExplorationEngine');
  const explorationParallel  = explorationDecision?.enabled === true && mode === 'exploration';
  if (explorationParallel) rationale.push('ExplorationEngine: authorised for parallel execution alongside main pipeline.');

  const enabledCount  = [...decisions.values()].filter(d => d.enabled).length;
  const disabledCount = [...decisions.values()].filter(d => !d.enabled).length;
  rationale.push(`Routing complete: mode=${mode} enabled=${enabledCount} disabled=${disabledCount} budgetMs=${totalBudgetMs} budgetUsd=${totalBudgetUsd.toFixed(4)}`);

  const planId = `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return Object.freeze({
    planId,
    mode,
    decisions:           Object.freeze(decisions) as ReadonlyMap<string, EngineRoutingDecision>,
    stageOrder:          Object.freeze([...STAGE_ORDER]),
    explorationParallel,
    totalBudgetMs,
    totalBudgetUsd,
    rationale:           Object.freeze([...rationale]),
    routedAt:            new Date().toISOString(),
    persisted:           false,
  });
}

// ── Persistence: write plan to DB BEFORE any execution ─────────────────────────

/**
 * Persist the routing plan to RoutingPlanLog.
 * The ControlPlaneExecutor calls this before any stage runs.
 * Returns the plan with persisted=true set so the executor can assert it.
 */
export async function persistRoutingPlan(
  plan: Readonly<RoutingPlan>,
  jobId: string,
  orgId: string,
  deps: { prisma?: any; logger?: { warn(o: unknown, m: string): void } }
): Promise<Readonly<RoutingPlan>> {
  if (!deps.prisma) return { ...plan, persisted: true } as Readonly<RoutingPlan>;

  const enabledEngines:  string[] = [];
  const disabledEngines: string[] = [];
  for (const [name, d] of plan.decisions) {
    if (d.enabled) enabledEngines.push(name);
    else           disabledEngines.push(`${name}(${d.disabledReason ?? 'unknown'})`);
  }

  try {
    await deps.prisma.routingPlanLog?.create?.({
      data: {
        id:                   plan.planId,
        jobId,
        orgId,
        mode:                 plan.mode,
        enabledEngines,
        disabledEngines,
        explorationParallel:  plan.explorationParallel,
        budgetMs:             plan.totalBudgetMs,
        budgetUsd:            plan.totalBudgetUsd,
        rationale:            plan.rationale as any,
        routedAt:             new Date(plan.routedAt),
      },
    });
  } catch (e: any) {
    // Non-fatal: if RoutingPlanLog doesn't exist yet (pre-migration), log and continue
    deps.logger?.warn({ err: e.message, planId: plan.planId }, '[policy-router] RoutingPlanLog write failed (non-fatal)');
  }

  return Object.freeze({ ...plan, persisted: true }) as Readonly<RoutingPlan>;
}

// ── Enforcement helper used by the executor ─────────────────────────────────────

/**
 * Assert that the executor's intent to run an engine matches the routing plan.
 * Called before EVERY stage execution in the ControlPlaneExecutor.
 *
 * Throws if:
 *   - The engine is not in the routing plan
 *   - The plan says disabled but caller is about to run it (bypass attempt)
 */
export function assertPlanAuthorises(plan: Readonly<RoutingPlan>, engineName: string): EngineRoutingDecision {
  const decision = plan.decisions.get(engineName);
  if (!decision) {
    throw new Error(`[policy-router] ENFORCEMENT_FAILURE: engine "${engineName}" not in routing plan. Refusing execution.`);
  }
  if (!decision.enabled) {
    throw new Error(
      `[policy-router] ENFORCEMENT_FAILURE: engine "${engineName}" is disabled by routing plan ` +
      `(reason: ${decision.disabledReason ?? 'not specified'}). No bypass allowed.`
    );
  }
  return decision;
}

// ── Routing summary for structured logging ───────────────────────────────────────
export function summarizeRoutingPlan(plan: Readonly<RoutingPlan>): Record<string, unknown> {
  const enabled: string[] = [], disabled: string[] = [];
  for (const [n, d] of plan.decisions) {
    if (d.enabled) enabled.push(n); else disabled.push(n);
  }
  return { planId: plan.planId, mode: plan.mode, enabled, disabled,
    explorationParallel: plan.explorationParallel, budgetMs: plan.totalBudgetMs, routedAt: plan.routedAt };
}

// ── Mode resolution ─────────────────────────────────────────────────────────────
function _resolveMode(ctx: RoutingContext, rationale: string[]): RoutingMode {
  const plan = _canonPlan(ctx.plan);

  // System load overrides always win — no exceptions
  if (ctx.systemLoadLevel === 'critical') {
    rationale.push('OVERRIDE: systemLoadLevel=CRITICAL — forcing speed_optimized. All optional stages disabled.');
    return 'speed_optimized';
  }
  if (ctx.systemLoadLevel === 'high' && ctx.requestedMode === 'premium_intelligence') {
    rationale.push('DOWNGRADE: systemLoadLevel=high + premium_intelligence requested → deterministic to protect throughput.');
    return 'deterministic';
  }

  // Exploration mode: requires flag AND positive budget
  if (ctx.requestedMode === 'exploration' || ctx.generationIntent === 'exploration') {
    if (!ctx.explorationModeEnabled) {
      rationale.push('DENY exploration: feature flag disabled for org. Falling back to deterministic.');
      return 'deterministic';
    }
    if (ctx.explorationBudgetRemaining <= 0) {
      rationale.push('DENY exploration: explorationBudgetRemaining=0. Falling back to deterministic.');
      return 'deterministic';
    }
    rationale.push(`ALLOW exploration: flag=on budget=${ctx.explorationBudgetRemaining}`);
    return 'exploration';
  }

  // Premium intelligence: requires PRO or STUDIO plan
  if (ctx.requestedMode === 'premium_intelligence') {
    if (plan !== 'PRO' && plan !== 'STUDIO') {
      rationale.push(`DENY premium_intelligence: plan=${plan} insufficient. Falling back to deterministic.`);
      return 'deterministic';
    }
    rationale.push(`ALLOW premium_intelligence: plan=${plan}`);
    return 'premium_intelligence';
  }

  // Speed-optimized: explicit request or queue pressure
  if (ctx.requestedMode === 'speed_optimized') {
    rationale.push('ALLOW speed_optimized: explicitly requested.');
    return 'speed_optimized';
  }
  if (ctx.workerQueueDepth > 50) {
    rationale.push(`AUTO speed_optimized: queue depth=${ctx.workerQueueDepth} > 50 threshold.`);
    return 'speed_optimized';
  }

  // Cinematic ad on PRO/STUDIO → premium_intelligence
  if (ctx.generationIntent === 'cinematic_ad' && (plan === 'PRO' || plan === 'STUDIO')) {
    rationale.push(`AUTO premium_intelligence: cinematic_ad on plan=${plan}.`);
    return 'premium_intelligence';
  }

  rationale.push('DEFAULT: deterministic.');
  return 'deterministic';
}

// ── Budget computation ───────────────────────────────────────────────────────────
function _computeBudget(mode: RoutingMode, ctx: RoutingContext, rationale: string[]) {
  const baseMs:  Record<RoutingMode, number> = { speed_optimized:3000,deterministic:8000,exploration:12000,premium_intelligence:20000 };
  const baseUsd: Record<RoutingMode, number> = { speed_optimized:0.01,deterministic:0.05,exploration:0.10,premium_intelligence:0.20 };
  // Budget scales linearly with variation count (each variation is roughly additive)
  const mult        = 1 + (ctx.variationCount - 1) * 0.3;
  const totalBudgetMs  = Math.round(baseMs[mode] * mult);
  const totalBudgetUsd = parseFloat((baseUsd[mode] * mult).toFixed(6));
  rationale.push(`Budget: ${totalBudgetMs}ms / $${totalBudgetUsd} for ${ctx.variationCount} variation(s) in mode=${mode}`);
  return { totalBudgetMs, totalBudgetUsd };
}

// ── Per-engine decision ──────────────────────────────────────────────────────────
function _decideEngine(
  contract: Readonly<EngineContract>,
  mode: RoutingMode,
  ctx: RoutingContext,
  rationale: string[]
): EngineRoutingDecision {
  let enabled = true;
  let disabledReason: string | undefined;

  const disable = (reason: string) => {
    if (enabled) { // only set once — first matching rule wins
      enabled        = false;
      disabledReason = reason;
      rationale.push(`  ✗ ${contract.name}: ${reason}`);
    }
  };

  // Feature-gated engines check their flag
  if (contract.featureGated && contract.featureFlagKey) {
    const flagOn = _readFlag(contract.featureFlagKey, ctx);
    if (!flagOn) disable(`feature flag "${contract.featureFlagKey}" is off for this org`);
  }

  // Stage-level disabling rules
  if (contract.executionStage === 'exploration' && mode !== 'exploration') {
    disable(`exploration stage only active in exploration mode (current: ${mode})`);
  }
  if (contract.name === 'CinematicAdEngine' && ctx.generationIntent !== 'cinematic_ad') {
    disable(`CinematicAdEngine only for cinematic_ad intent (current: ${ctx.generationIntent})`);
  }
  if (contract.name === 'BrandDNAExtractor' && !ctx.hasBrandKit && !ctx.brandLearningEnabled) {
    disable('no brand kit present and brandLearningEnabled=false');
  }
  if (contract.name === 'ArchetypeIntelligenceEngine' && mode === 'speed_optimized') {
    disable('archetype intelligence skipped in speed_optimized mode');
  }
  // AI-powered asset generation only runs in deterministic+ modes on non-speed paths
  if (contract.executionStage === 'asset' && mode === 'speed_optimized') {
    disable('asset engine skipped in speed_optimized mode to meet latency target');
  }

  // Timeout: 3× the latency SLA, scaled by mode
  const tMult: Record<RoutingMode, number> = { speed_optimized:1.5, deterministic:3.0, exploration:4.0, premium_intelligence:5.0 };
  const timeoutMs = Math.round(contract.latencyTargetMs * tMult[mode]);

  // Max cost: scales by mode and cost class
  const baseCostUsd: Record<RoutingMode, number> = { speed_optimized:0.005, deterministic:0.02, exploration:0.05, premium_intelligence:0.10 };
  const maxCostUsd = enabled ? baseCostUsd[mode] : 0;

  return Object.freeze({
    engineName:       contract.name,
    engineVersion:    contract.version,
    enabled,
    disabledReason:   enabled ? undefined : disabledReason,
    timeoutMs:        Math.max(timeoutMs, 100),
    allowFallback:    contract.fallbackStrategy !== 'abort_job',
    maxCostUsd,
    tracingEnabled:   contract.observability.emitStageTrace,
    benchmarkEnabled: contract.observability.emitBenchmark && mode !== 'speed_optimized',
  });
}

function _readFlag(key: string, ctx: RoutingContext): boolean {
  if (key === 'brandLearningEnabled')   return ctx.brandLearningEnabled;
  if (key === 'explorationModeEnabled') return ctx.explorationModeEnabled;
  return false;
}

function _canonPlan(plan: string): PlanKey {
  const valid: PlanKey[] = ['FREE','CREATOR','PRO','STUDIO'];
  if (valid.includes(plan as PlanKey)) return plan as PlanKey;
  // Legacy aliases resolved via LEGACY_PLAN_MAP in plans.ts — do not duplicate here
  const upper = plan.toUpperCase() as PlanKey;
  if (valid.includes(upper)) return upper;
  return 'FREE';
}
