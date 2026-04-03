// packages/shared/src/engineRegistry.ts
// FORMAL AI ENGINE REGISTRY — Production-Grade v2
//
// ENFORCEMENT GUARANTEE: The Policy Router and ControlPlaneExecutor call
// assertEngineRegistered() before every stage executes. Any engine not
// present in this registry is BLOCKED from running — there is no bypass path.
//
// Design guarantees:
//   1. Schema validation at registration — structural correctness enforced at boot
//   2. Dependency chain validation — no dangling deps (validateRegistryIntegrity)
//   3. Runtime contract lookup — assertEngineRegistered() throws on unknown engines
//   4. alwaysRun enforcement — assertRoutingValid() throws on illegal disable
//   5. Immutable after lockRegistry() — no hot-patch or mid-flight modification
//   6. All violations surface as structured RegistryViolationError

import { z } from 'zod';

// ── Structured enforcement error ────────────────────────────────────────────────
export class RegistryViolationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'RegistryViolationError';
    this.code = code;
  }
}

// ── Core enums ──────────────────────────────────────────────────────────────────
export const ExecutionStageSchema = z.enum([
  'pre_intent','intent','layout','variation','audience',
  'density','brand','asset','exploration','cinematic','post_process',
]);
export type ExecutionStage = z.infer<typeof ExecutionStageSchema>;

export const CostClassSchema = z.enum(['free','cheap','moderate','expensive']);
export type CostClass = z.infer<typeof CostClassSchema>;

export const FallbackStrategySchema = z.enum([
  'deterministic_defaults','previous_version','skip_stage','abort_job',
]);
export type FallbackStrategy = z.infer<typeof FallbackStrategySchema>;

export const ObservabilityHooksSchema = z.object({
  emitStageTrace:   z.boolean().default(true),
  emitMetric:       z.boolean().default(true),
  emitBenchmark:    z.boolean().default(false),
  alertOnFallback:  z.boolean().default(true),
  alertOnSlaBreach: z.boolean().default(true),
});
export type ObservabilityHooks = z.infer<typeof ObservabilityHooksSchema>;

// ── Engine contract ──────────────────────────────────────────────────────────────
export const EngineContractSchema = z.object({
  name:             z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'name must be CamelCase alphanumeric'),
  version:          z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver x.y.z'),
  purpose:          z.string().min(1).max(256),
  executionStage:   ExecutionStageSchema,
  dependencies:     z.array(z.string().min(1)).default([]),
  inputSchemaKey:   z.string().min(1),
  outputSchemaKey:  z.string().min(1),
  latencyTargetMs:  z.number().int().positive(),
  costClass:        CostClassSchema,
  fallbackStrategy: FallbackStrategySchema,
  observability:    ObservabilityHooksSchema,
  parallelSafe:     z.boolean().default(false),
  idempotent:       z.boolean().default(true),
  featureGated:     z.boolean().default(false),
  featureFlagKey:   z.string().optional(),
  alwaysRun:        z.boolean().default(false),
});
export type EngineContract = z.infer<typeof EngineContractSchema>;

export interface EngineValidationRecord {
  name: string; version: string; validatedAt: string; passed: boolean; violations: string[];
}

// ── Registry singleton state ─────────────────────────────────────────────────────
const _registry      = new Map<string, Readonly<EngineContract>>();
let   _locked        = false;
let   _bootValidated = false;

function _key(name: string, version: string) { return `${name}@${version}`; }

// ── Registration ────────────────────────────────────────────────────────────────

/** Register an engine contract. Must be called before lockRegistry(). */
export function registerEngine(contract: EngineContract): void {
  if (_locked) {
    throw new RegistryViolationError('REGISTRY_LOCKED', `Cannot register "${contract.name}" — registry is locked.`);
  }
  const parsed = EngineContractSchema.safeParse(contract);
  if (!parsed.success) {
    const issues = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new RegistryViolationError('CONTRACT_SCHEMA_INVALID', `Invalid contract for "${contract.name}": ${issues}`);
  }
  const key = _key(parsed.data.name, parsed.data.version);
  if (_registry.has(key)) {
    throw new RegistryViolationError('DUPLICATE_REGISTRATION', `Engine "${key}" already registered.`);
  }
  _registry.set(key, Object.freeze({ ...parsed.data }));
}

/** Lock the registry. No further registrations after this. Call once at app startup. */
export function lockRegistry(): void { _locked = true; }

/**
 * Validate all dependency chains. Call after lockRegistry(). Throws on any violation.
 * This is the boot integrity check — if it passes, the registry is trusted at runtime.
 */
export function validateRegistryIntegrity(): EngineValidationRecord[] {
  const records: EngineValidationRecord[] = [];
  for (const contract of _registry.values()) {
    const violations: string[] = [];
    for (const dep of contract.dependencies) {
      if (!isEngineRegistered(dep)) violations.push(`Dependency "${dep}" not registered`);
    }
    if (contract.featureGated && !contract.featureFlagKey) {
      violations.push('featureGated=true but featureFlagKey is missing');
    }
    if (contract.fallbackStrategy === 'abort_job' && !contract.alwaysRun) {
      violations.push('abort_job fallback on non-alwaysRun engine is unsafe');
    }
    records.push({
      name:        contract.name,
      version:     contract.version,
      validatedAt: new Date().toISOString(),
      passed:      violations.length === 0,
      violations,
    });
    if (violations.length > 0) {
      throw new RegistryViolationError(
        'INTEGRITY_VIOLATION',
        `Engine "${contract.name}@${contract.version}" integrity failed: ${violations.join('; ')}`
      );
    }
  }
  _bootValidated = true;
  return records;
}

// ── Runtime enforcement ─────────────────────────────────────────────────────────

/** Assert registry is locked AND integrity-validated. Call at the start of every pipeline execution. */
export function assertRegistryReady(): void {
  if (!_locked)        throw new RegistryViolationError('REGISTRY_NOT_LOCKED', 'Registry must be locked before pipeline execution.');
  if (!_bootValidated) throw new RegistryViolationError('REGISTRY_NOT_VALIDATED', 'Call validateRegistryIntegrity() before running pipelines.');
}

/**
 * Assert that a named engine is registered. Throws RegistryViolationError if not.
 * Called by the ControlPlaneExecutor before every stage — enforces the "no unknown engines" guarantee.
 */
export function assertEngineRegistered(name: string): Readonly<EngineContract> {
  const contract = getLatestEngine(name);
  if (!contract) {
    throw new RegistryViolationError(
      'ENGINE_NOT_REGISTERED',
      `Engine "${name}" is not registered and cannot execute. Register it via registerEngine() before lockRegistry().`
    );
  }
  return contract;
}

/**
 * Assert that a routing decision is consistent with the engine's contract.
 * Called for every engine in every routing plan before execution begins.
 * alwaysRun engines cannot be disabled by any routing mode.
 */
export function assertRoutingValid(engineName: string, enabled: boolean, routingMode: string): void {
  const contract = getLatestEngine(engineName);
  if (!contract) return; // only validates registered engines
  if (contract.alwaysRun && !enabled) {
    throw new RegistryViolationError(
      'ALWAYS_RUN_DISABLED',
      `Engine "${engineName}" is alwaysRun=true but routing mode "${routingMode}" disabled it. ` +
      `This is a policy conflict — the routing plan must not disable always-run engines.`
    );
  }
}

/**
 * Validate that an engine's runtime execution cost is within its contract.
 * Called after each stage completes to detect cost overruns.
 */
export function assertCostWithinContract(engineName: string, actualCostUsd: number): void {
  const contract = getLatestEngine(engineName);
  if (!contract) return;
  const maxByCostClass: Record<CostClass, number> = { free: 0, cheap: 0.001, moderate: 0.01, expensive: 1.0 };
  const ceiling = maxByCostClass[contract.costClass];
  if (actualCostUsd > ceiling) {
    // Non-throwing: log a contract violation but do not abort the pipeline
    // The cost has already been incurred — aborting here would orphan the output
    // Instead, this is emitted as an observability alert for ops review
    console.warn(
      `[registry] COST_CONTRACT_BREACH: engine="${engineName}" ` +
      `actualUsd=${actualCostUsd.toFixed(6)} ceiling=${ceiling} costClass=${contract.costClass}`
    );
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────────
export function getEngine(name: string, version: string): Readonly<EngineContract> | undefined {
  return _registry.get(_key(name, version));
}
export function getLatestEngine(name: string): Readonly<EngineContract> | undefined {
  let latest: Readonly<EngineContract> | undefined;
  for (const c of _registry.values()) {
    if (c.name !== name) continue;
    if (!latest || _semverGt(c.version, latest.version)) latest = c;
  }
  return latest;
}
export function getEnginesForStage(stage: ExecutionStage): Readonly<EngineContract>[] {
  return _topologicalSort([..._registry.values()].filter(c => c.executionStage === stage));
}
export function getAllEngines(): Readonly<EngineContract>[] { return [..._registry.values()]; }
export function isEngineRegistered(name: string): boolean {
  for (const c of _registry.values()) { if (c.name === name) return true; }
  return false;
}
export function isRegistryLocked(): boolean    { return _locked; }
export function isRegistryValidated(): boolean { return _bootValidated; }

function _semverGt(a: string, b: string): boolean {
  const [am, an, ap] = a.split('.').map(Number);
  const [bm, bn, bp] = b.split('.').map(Number);
  if (am !== bm) return am > bm;
  if (an !== bn) return an > bn;
  return ap > bp;
}
function _topologicalSort(engines: Readonly<EngineContract>[]): Readonly<EngineContract>[] {
  const map = new Map(engines.map(e => [e.name, e]));
  const visited = new Set<string>();
  const result: Readonly<EngineContract>[] = [];
  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const e = map.get(name);
    if (!e) return;
    for (const dep of e.dependencies) visit(dep);
    result.push(e);
  }
  for (const e of engines) visit(e.name);
  return result;
}

// ── Canonical engine registrations ──────────────────────────────────────────────
// These are the only engines the platform recognises. Any engine not in this
// function cannot execute — the ControlPlaneExecutor enforces this at runtime.
export function registerAllEngines(): void {
  if (_locked) return;
  // Intent normalization — always runs, no cost, mandatory for all pipelines
  registerEngine({ name:'IntentNormalization',version:'1.0.0',purpose:'Normalize raw user intent into typed Intent struct.',executionStage:'intent',dependencies:[],inputSchemaKey:'RawIntentInput',outputSchemaKey:'Intent',latencyTargetMs:20,costClass:'free',fallbackStrategy:'deterministic_defaults',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:false,alertOnFallback:true,alertOnSlaBreach:false},parallelSafe:false,idempotent:true,featureGated:false,alwaysRun:true });
  // Layout intelligence — mandatory, pure computation, deterministic fallbacks
  registerEngine({ name:'LayoutIntelligence',version:'1.0.0',purpose:'Infer layout strategy (type, zone, whitespace) from intent and format.',executionStage:'layout',dependencies:['IntentNormalization'],inputSchemaKey:'Intent',outputSchemaKey:'LayoutStrategy',latencyTargetMs:30,costClass:'free',fallbackStrategy:'deterministic_defaults',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:true,alertOnFallback:true,alertOnSlaBreach:false},parallelSafe:true,idempotent:true,featureGated:false,alwaysRun:true });
  // Auto-variation — mandatory, selects diversity axes within plan constraints
  registerEngine({ name:'AutoVariation',version:'1.0.0',purpose:'Plan variation count, axes, and diversity within plan limits.',executionStage:'variation',dependencies:['IntentNormalization'],inputSchemaKey:'Intent',outputSchemaKey:'VariationStrategy',latencyTargetMs:20,costClass:'free',fallbackStrategy:'deterministic_defaults',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:false,alertOnFallback:true,alertOnSlaBreach:false},parallelSafe:true,idempotent:true,featureGated:false,alwaysRun:true });
  // Audience style — mandatory, models segment and tone for downstream stages
  registerEngine({ name:'AudienceStyleEngine',version:'1.0.0',purpose:'Model audience segment, tone, and visual complexity from intent.',executionStage:'audience',dependencies:['IntentNormalization'],inputSchemaKey:'Intent',outputSchemaKey:'AudienceProfile',latencyTargetMs:25,costClass:'free',fallbackStrategy:'deterministic_defaults',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:true,alertOnFallback:false,alertOnSlaBreach:false},parallelSafe:true,idempotent:true,featureGated:false,alwaysRun:true });
  // Content density optimizer — mandatory, depends on layout + audience
  registerEngine({ name:'ContentDensityOptimizer',version:'1.0.0',purpose:'Optimize text block count, max chars, hierarchy, and font sizing.',executionStage:'density',dependencies:['LayoutIntelligence','AudienceStyleEngine'],inputSchemaKey:'LayoutStrategy+AudienceProfile',outputSchemaKey:'DensityProfile',latencyTargetMs:20,costClass:'free',fallbackStrategy:'deterministic_defaults',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:false,alertOnFallback:false,alertOnSlaBreach:false},parallelSafe:false,idempotent:true,featureGated:false,alwaysRun:true });
  // Brand DNA extractor — feature-gated: only active when brandLearningEnabled
  registerEngine({ name:'BrandDNAExtractor',version:'1.0.0',purpose:'Extract cumulative brand signals from org brand kit for downstream enrichment.',executionStage:'brand',dependencies:['IntentNormalization'],inputSchemaKey:'BrandKit',outputSchemaKey:'BrandSignals',latencyTargetMs:40,costClass:'free',fallbackStrategy:'deterministic_defaults',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:false,alertOnFallback:false,alertOnSlaBreach:false},parallelSafe:true,idempotent:true,featureGated:true,featureFlagKey:'brandLearningEnabled',alwaysRun:false });
  // Archetype + preset intelligence — selects optimal visual archetype
  registerEngine({ name:'ArchetypeIntelligenceEngine',version:'1.0.0',purpose:'Select optimal visual archetype and style preset from 20-archetype library.',executionStage:'brand',dependencies:['BrandDNAExtractor','AudienceStyleEngine'],inputSchemaKey:'ArchetypeSelectionInput',outputSchemaKey:'ArchetypeSelection',latencyTargetMs:50,costClass:'free',fallbackStrategy:'deterministic_defaults',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:true,alertOnFallback:false,alertOnSlaBreach:false},parallelSafe:true,idempotent:true,featureGated:false,alwaysRun:false });
  // Asset generation engine — AI-powered, feature-gated by plan + cost class
  registerEngine({ name:'AssetGenerationEngine',version:'2.0.0',purpose:'Generate missing visual sub-assets via AI APIs with similarity-hash dedup.',executionStage:'asset',dependencies:['LayoutIntelligence','BrandDNAExtractor'],inputSchemaKey:'AssetGenerationRequest',outputSchemaKey:'GeneratedAsset',latencyTargetMs:8000,costClass:'expensive',fallbackStrategy:'skip_stage',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:true,alertOnFallback:true,alertOnSlaBreach:true},parallelSafe:true,idempotent:true,featureGated:false,alwaysRun:false });
  // Exploration engine — feature-gated by explorationModeEnabled + budget
  registerEngine({ name:'ExplorationEngine',version:'1.0.0',purpose:'Generate novel high-diversity candidates using UCB-style exploration priors.',executionStage:'exploration',dependencies:['IntentNormalization','AudienceStyleEngine'],inputSchemaKey:'ExplorationRequest',outputSchemaKey:'ExplorationRun',latencyTargetMs:5000,costClass:'moderate',fallbackStrategy:'skip_stage',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:true,alertOnFallback:false,alertOnSlaBreach:true},parallelSafe:true,idempotent:false,featureGated:true,featureFlagKey:'explorationModeEnabled',alwaysRun:false });
  // Cinematic ad engine — only runs for cinematic_ad intent on PRO/STUDIO plans
  registerEngine({ name:'CinematicAdEngine',version:'1.0.0',purpose:'2.5D cinematic depth compositing and motion path planning for ad formats.',executionStage:'cinematic',dependencies:['AssetGenerationEngine','LayoutIntelligence'],inputSchemaKey:'CinematicAdRequest',outputSchemaKey:'CinematicAdOutput',latencyTargetMs:15000,costClass:'expensive',fallbackStrategy:'previous_version',observability:{emitStageTrace:true,emitMetric:true,emitBenchmark:true,alertOnFallback:true,alertOnSlaBreach:true},parallelSafe:false,idempotent:true,featureGated:false,alwaysRun:false });

  lockRegistry();
  validateRegistryIntegrity();
}
