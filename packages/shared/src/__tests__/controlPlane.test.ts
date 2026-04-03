// packages/shared/src/__tests__/controlPlane.test.ts
// Control Plane — Production-grade test suite covering all subsystems

import {
  // Engine Registry
  registerEngine, lockRegistry, validateRegistryIntegrity, registerAllEngines,
  assertEngineRegistered, assertRegistryReady, assertRoutingValid, isRegistryLocked,
  RegistryViolationError,
  type EngineContract,
} from '../engineRegistry';

import {
  // Policy Router
  computeRoutingPlan, summarizeRoutingPlan, assertPlanAuthorises,
  type RoutingContext, type RoutingPlan,
} from '../policyRouter';

import {
  // Crash Safety
  createCrashSafetyService, computeRetryDelay, shouldRetry,
  isLegalTransition, classifyFailure, isPermanentFailure,
  DEFAULT_RETRY_CONFIG,
  type ExtendedJobStatus,
} from '../crashSafety';

import {
  // Unified Memory
  writeUserTasteSignal, writeRejectedOutputSignal, writeBrandDNAMemory,
  DOMAIN_WRITE_PERMISSIONS,
} from '../unifiedMemory';

import {
  // Asset Graph
  buildAssetRelationships, recordAssetRelationships,
} from '../assetGraph';

import {
  // Control Plane
  initializeControlPlane,
} from '../controlPlane';

// ── Test helpers ────────────────────────────────────────────────────────────────

function makeContract(overrides: Partial<EngineContract> = {}): EngineContract {
  return {
    name:             'TestEngine',
    version:          '1.0.0',
    purpose:          'Test engine for unit tests',
    executionStage:   'intent',
    dependencies:     [],
    inputSchemaKey:   'TestInput',
    outputSchemaKey:  'TestOutput',
    latencyTargetMs:  100,
    costClass:        'free',
    fallbackStrategy: 'deterministic_defaults',
    observability: {
      emitStageTrace:   true,
      emitMetric:       true,
      emitBenchmark:    false,
      alertOnFallback:  false,
      alertOnSlaBreach: false,
    },
    parallelSafe: false,
    idempotent:   true,
    featureGated: false,
    alwaysRun:    false,
    ...overrides,
  };
}

function makeRoutingCtx(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    orgId:            'org_test',
    userId:           'usr_test',
    plan:             'PRO',
    generationIntent: 'normal_ad',
    format:           'instagram_post',
    variationCount:   2,
    systemLoadLevel:  'normal',
    workerQueueDepth: 5,
    brandLearningEnabled:       false,
    explorationModeEnabled:     false,
    hasBrandKit:                false,
    explorationBudgetRemaining: 0,
    ...overrides,
  };
}

const noDeps = { prisma: undefined, logger: undefined };

// ── Engine Registry tests ───────────────────────────────────────────────────────

describe('EngineRegistry', () => {
  // Registry is a module singleton — we can only test the already-locked state
  // because registerAllEngines() is called at module level in the test env.

  test('registerAllEngines produces a non-empty locked registry', () => {
    expect(isRegistryLocked()).toBe(true);
  });

  test('assertEngineRegistered succeeds for a known engine', () => {
    const contract = assertEngineRegistered('LayoutIntelligence');
    expect(contract.name).toBe('LayoutIntelligence');
    expect(contract.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(contract.alwaysRun).toBe(true);
  });

  test('assertEngineRegistered throws for an unknown engine', () => {
    expect(() => assertEngineRegistered('NonExistentEngine')).toThrow(RegistryViolationError);
    expect(() => assertEngineRegistered('NonExistentEngine')).toThrow('ENGINE_NOT_REGISTERED');
  });

  test('RegistryViolationError has structured code', () => {
    try {
      assertEngineRegistered('BogusEngine');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryViolationError);
      expect((e as RegistryViolationError).code).toBe('ENGINE_NOT_REGISTERED');
    }
  });

  test('assertRoutingValid throws when alwaysRun engine is disabled', () => {
    expect(() => assertRoutingValid('LayoutIntelligence', false, 'speed_optimized')).toThrow(RegistryViolationError);
    expect(() => assertRoutingValid('LayoutIntelligence', false, 'speed_optimized')).toThrow('ALWAYS_RUN_DISABLED');
  });

  test('assertRoutingValid does not throw for non-alwaysRun engine disabled', () => {
    expect(() => assertRoutingValid('ExplorationEngine', false, 'deterministic')).not.toThrow();
  });

  test('assertRegistryReady does not throw when locked and validated', () => {
    expect(() => assertRegistryReady()).not.toThrow();
  });

  test('all mandatory alwaysRun engines have idempotent=true', () => {
    const alwaysRun = ['IntentNormalization','LayoutIntelligence','AutoVariation','AudienceStyleEngine','ContentDensityOptimizer'];
    for (const name of alwaysRun) {
      const contract = assertEngineRegistered(name);
      expect(contract.alwaysRun).toBe(true);
      expect(contract.idempotent).toBe(true);
    }
  });

  test('expensive engines have explicit SLA targets', () => {
    const expensive = ['AssetGenerationEngine','CinematicAdEngine'];
    for (const name of expensive) {
      const contract = assertEngineRegistered(name);
      expect(contract.costClass).toBe('expensive');
      expect(contract.latencyTargetMs).toBeGreaterThan(1000);
    }
  });
});

// ── Policy Router tests ─────────────────────────────────────────────────────────

describe('PolicyRouter — mode resolution', () => {
  test('critical system load forces speed_optimized regardless of request', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ systemLoadLevel: 'critical', requestedMode: 'premium_intelligence' }));
    expect(plan.mode).toBe('speed_optimized');
    expect(plan.rationale.some(r => r.includes('critical'))).toBe(true);
  });

  test('high load downgrades premium_intelligence to deterministic', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ systemLoadLevel: 'high', requestedMode: 'premium_intelligence' }));
    expect(plan.mode).toBe('deterministic');
  });

  test('default mode is deterministic for normal conditions', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    expect(plan.mode).toBe('deterministic');
  });

  test('exploration mode denied without feature flag', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ requestedMode: 'exploration', explorationModeEnabled: false }));
    expect(plan.mode).toBe('deterministic');
    expect(plan.rationale.some(r => r.toLowerCase().includes('flag'))).toBe(true);
  });

  test('exploration mode denied with zero budget', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ requestedMode: 'exploration', explorationModeEnabled: true, explorationBudgetRemaining: 0 }));
    expect(plan.mode).toBe('deterministic');
  });

  test('exploration mode granted with flag + positive budget', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ requestedMode: 'exploration', explorationModeEnabled: true, explorationBudgetRemaining: 100 }));
    expect(plan.mode).toBe('exploration');
  });

  test('premium_intelligence requires PRO or STUDIO plan', () => {
    const freePlan = computeRoutingPlan(makeRoutingCtx({ plan: 'FREE', requestedMode: 'premium_intelligence' }));
    expect(freePlan.mode).toBe('deterministic');
    const proPlan  = computeRoutingPlan(makeRoutingCtx({ plan: 'PRO', requestedMode: 'premium_intelligence' }));
    expect(proPlan.mode).toBe('premium_intelligence');
  });

  test('high queue depth triggers auto speed_optimized', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ workerQueueDepth: 100 }));
    expect(plan.mode).toBe('speed_optimized');
  });

  test('routing plan is frozen (immutable)', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    expect(() => { (plan as any).mode = 'exploration'; }).toThrow();
  });

  test('routing plan has a unique planId', () => {
    const p1 = computeRoutingPlan(makeRoutingCtx());
    const p2 = computeRoutingPlan(makeRoutingCtx());
    expect(p1.planId).not.toBe(p2.planId);
  });

  test('routing plan persisted=false before persistRoutingPlan()', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    expect(plan.persisted).toBe(false);
  });

  test('budget scales with variation count', () => {
    const p1 = computeRoutingPlan(makeRoutingCtx({ variationCount: 1 }));
    const p2 = computeRoutingPlan(makeRoutingCtx({ variationCount: 4 }));
    expect(p2.totalBudgetMs).toBeGreaterThan(p1.totalBudgetMs);
    expect(p2.totalBudgetUsd).toBeGreaterThan(p1.totalBudgetUsd);
  });
});

describe('PolicyRouter — engine decisions', () => {
  test('alwaysRun engines are enabled in every mode', () => {
    const modes = ['speed_optimized','deterministic','premium_intelligence'] as const;
    const alwaysRunEngines = ['IntentNormalization','LayoutIntelligence','AutoVariation','AudienceStyleEngine','ContentDensityOptimizer'];
    for (const mode of modes) {
      let ctx = makeRoutingCtx({ requestedMode: mode as any });
      if (mode === 'premium_intelligence') ctx = makeRoutingCtx({ plan: 'PRO', requestedMode: mode });
      const plan = computeRoutingPlan(ctx);
      for (const engine of alwaysRunEngines) {
        const d = plan.decisions.get(engine);
        expect(d?.enabled).toBe(true);
      }
    }
  });

  test('ExplorationEngine is disabled in non-exploration mode', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    const decision = plan.decisions.get('ExplorationEngine');
    expect(decision?.enabled).toBe(false);
    expect(decision?.disabledReason).toBeDefined();
  });

  test('CinematicAdEngine disabled for non-cinematic intents', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ generationIntent: 'normal_ad' }));
    const d = plan.decisions.get('CinematicAdEngine');
    expect(d?.enabled).toBe(false);
  });

  test('every disabled decision has a disabledReason set', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    for (const [name, d] of plan.decisions) {
      if (!d.enabled) expect(d.disabledReason).toBeTruthy();
    }
  });

  test('assertPlanAuthorises throws for disabled engine', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    expect(() => assertPlanAuthorises(plan, 'ExplorationEngine')).toThrow('ENFORCEMENT_FAILURE');
  });

  test('assertPlanAuthorises returns decision for enabled engine', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    const d = assertPlanAuthorises(plan, 'LayoutIntelligence');
    expect(d.enabled).toBe(true);
    expect(d.timeoutMs).toBeGreaterThan(0);
  });

  test('timeoutMs is > 0 for all enabled engines', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    for (const [_, d] of plan.decisions) {
      if (d.enabled) expect(d.timeoutMs).toBeGreaterThan(0);
    }
  });
});

// ── Crash Safety tests ──────────────────────────────────────────────────────────

describe('CrashSafety — FSM transitions', () => {
  test('queued → running is legal', () => expect(isLegalTransition('queued', 'running')).toBe(true));
  test('running → completed is legal', () => expect(isLegalTransition('running', 'completed')).toBe(true));
  test('running → retrying is legal', () => expect(isLegalTransition('running', 'retrying')).toBe(true));
  test('running → recovered is legal', () => expect(isLegalTransition('running', 'recovered')).toBe(true));
  test('retrying → running is legal', () => expect(isLegalTransition('retrying', 'running')).toBe(true));
  test('failed → dead_lettered is legal', () => expect(isLegalTransition('failed', 'dead_lettered')).toBe(true));
  test('dead_lettered → credit_protected is legal', () => expect(isLegalTransition('dead_lettered', 'credit_protected')).toBe(true));

  test('completed → anything is illegal (terminal)', () => {
    const states: ExtendedJobStatus[] = ['queued','running','retrying','failed','recovered','dead_lettered','credit_protected'];
    for (const s of states) expect(isLegalTransition('completed', s)).toBe(false);
  });
  test('credit_protected → anything is illegal (terminal)', () => {
    const states: ExtendedJobStatus[] = ['queued','running','retrying','failed','recovered','completed','dead_lettered'];
    for (const s of states) expect(isLegalTransition('credit_protected', s)).toBe(false);
  });
  test('queued → completed is illegal (must go through running)', () => {
    expect(isLegalTransition('queued', 'completed')).toBe(false);
  });
  test('running → queued is illegal (no backward loop)', () => {
    expect(isLegalTransition('running', 'queued')).toBe(false);
  });
});

describe('CrashSafety — failure classification', () => {
  const permanent = ['KILL_SWITCH_ACTIVE','CREDIT_INSUFFICIENT','PLAN_LIMIT_EXCEEDED','SAFETY_VIOLATION','SPEND_GUARD_ACTIVE','ENGINE_NOT_REGISTERED','ENFORCEMENT_FAILURE'];
  const transient  = ['PROVIDER_TIMEOUT','RATE_LIMITED','TRANSIENT_ERROR','CONNECTION_RESET','UPSTREAM_503','JOB_TIMEOUT'];

  for (const code of permanent) {
    test(`${code} is classified as permanent`, () => {
      expect(classifyFailure(code)).toBe('permanent');
      expect(isPermanentFailure(code)).toBe(true);
    });
  }

  for (const code of transient) {
    test(`${code} is classified as transient`, () => {
      expect(classifyFailure(code)).toBe('transient');
      expect(isPermanentFailure(code)).toBe(false);
    });
  }

  test('unknown error code defaults to transient (safe retry default)', () => {
    expect(classifyFailure('TOTALLY_UNKNOWN_ERROR')).toBe('transient');
  });
});

describe('CrashSafety — retry logic', () => {
  test('exponential backoff grows on each attempt', () => {
    // Use fixed jitterFactor=0 for deterministic comparison
    const cfg = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 };
    const d1 = computeRetryDelay(1, cfg);
    const d2 = computeRetryDelay(2, cfg);
    const d3 = computeRetryDelay(3, cfg);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });

  test('delay is capped at maxDelayMs', () => {
    const cfg = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0, maxDelayMs: 5_000 };
    const d10 = computeRetryDelay(10, cfg);
    expect(d10).toBeLessThanOrEqual(5_000);
  });

  test('delay is at least baseDelayMs', () => {
    const d1 = computeRetryDelay(1, DEFAULT_RETRY_CONFIG);
    expect(d1).toBeGreaterThanOrEqual(DEFAULT_RETRY_CONFIG.baseDelayMs);
  });

  test('permanent error codes are never retried', () => {
    expect(shouldRetry('KILL_SWITCH_ACTIVE', 1)).toBe(false);
    expect(shouldRetry('CREDIT_INSUFFICIENT', 2)).toBe(false);
  });

  test('transient errors retry until maxAttempts', () => {
    expect(shouldRetry('PROVIDER_TIMEOUT', 1)).toBe(true);
    expect(shouldRetry('PROVIDER_TIMEOUT', 2)).toBe(true);
    expect(shouldRetry('PROVIDER_TIMEOUT', 3)).toBe(false); // maxAttempts=3
  });

  test('timeoutGuard rejects after delay', async () => {
    const cs = createCrashSafetyService(noDeps);
    await expect(Promise.race([
      new Promise(resolve => setTimeout(resolve, 200)),
      cs.timeoutGuard('job_test', 50),
    ])).rejects.toThrow('timed out');
  });
});

describe('CrashSafety — no-prisma graceful degradation', () => {
  test('saveCheckpoint with no prisma does not throw', async () => {
    const cs = createCrashSafetyService(noDeps);
    await expect(cs.saveCheckpoint({ jobId:'j1',orgId:'o1',stage:'layout',stageIdx:0,stageOutputs:{},completedStages:[],savedAt:new Date().toISOString(),attemptNumber:1 })).resolves.toBeUndefined();
  });
  test('recoverFromCheckpoint with no prisma returns null', async () => {
    const cs = createCrashSafetyService(noDeps);
    expect(await cs.recoverFromCheckpoint('job_1')).toBeNull();
  });
  test('transitionJob with no prisma returns false', async () => {
    const cs = createCrashSafetyService(noDeps);
    expect(await cs.transitionJob('job_1', 'running')).toBe(false);
  });
  test('getDiagnostics with no prisma returns null', async () => {
    const cs = createCrashSafetyService(noDeps);
    expect(await cs.getDiagnostics('job_1')).toBeNull();
  });
  test('sendToDeadLetter with no prisma does not throw', async () => {
    const cs = createCrashSafetyService(noDeps);
    await expect(cs.sendToDeadLetter('job_1','KILL_SWITCH_ACTIVE','test error',{})).resolves.toBeUndefined();
  });
});

// ── Unified Memory tests ────────────────────────────────────────────────────────

describe('UnifiedMemory — write permission model', () => {
  test('user_taste and rejected_outputs are feedback_only', () => {
    expect(DOMAIN_WRITE_PERMISSIONS['user_taste']).toBe('feedback_only');
    expect(DOMAIN_WRITE_PERMISSIONS['rejected_outputs']).toBe('feedback_only');
  });
  test('brand_dna and exploration_priors are engine_output', () => {
    expect(DOMAIN_WRITE_PERMISSIONS['brand_dna']).toBe('engine_output');
    expect(DOMAIN_WRITE_PERMISSIONS['exploration_priors']).toBe('engine_output');
  });
  test('all 7 domains have a write permission defined', () => {
    const domains = ['user_taste','brand_dna','winning_templates','exploration_priors','rejected_outputs','platform_performance','campaign_history'];
    for (const d of domains) expect(DOMAIN_WRITE_PERMISSIONS[d as keyof typeof DOMAIN_WRITE_PERMISSIONS]).toBeTruthy();
  });
  test('writeUserTasteSignal rejects invalid signal (no orgId)', async () => {
    const writes: unknown[] = [];
    const fakeDeps = { prisma: { aIFeedbackEvent: { create: (d: unknown) => { writes.push(d); return Promise.resolve(); } } }, logger: undefined };
    // Missing required userId field
    await writeUserTasteSignal({ orgId:'', userId:'', stylePreset:'', accepted:true, sessionId:'', recordedAt:'' } as any, fakeDeps as any);
    // Should have rejected and not written (orgId is empty string which fails min(1))
    expect(writes.length).toBe(0);
  });
  test('writeRejectedOutputSignal validates similarityHash', async () => {
    const writes: unknown[] = [];
    const fakeDeps = { prisma: { aIFeedbackEvent: { create: (d: unknown) => { writes.push(d); return Promise.resolve(); }, memorySignalLog: { create: () => Promise.resolve() } } }, logger: undefined };
    // Missing similarityHash
    await writeRejectedOutputSignal({ orgId:'o1',similarityHash:'',rejectedAt:new Date().toISOString(),sessionId:'s1' } as any, fakeDeps as any);
    expect(writes.length).toBe(0);
  });
  test('memory writes do not throw when prisma is undefined', async () => {
    await expect(writeUserTasteSignal({ orgId:'o1',userId:'u1',stylePreset:'modern',accepted:true,sessionId:'s1',recordedAt:new Date().toISOString() }, noDeps)).resolves.toBeUndefined();
    await expect(writeRejectedOutputSignal({ orgId:'o1',similarityHash:'abc123',rejectedAt:new Date().toISOString(),sessionId:'s1' }, noDeps)).resolves.toBeUndefined();
    await expect(writeBrandDNAMemory({ orgId:'o1',brandId:'b1',dominantColors:['#fff'],toneKeywords:[],logoPosition:'top-left',prefersDarkBg:false,confidence:0.8,updatedAt:new Date().toISOString(),sampleCount:5 }, noDeps)).resolves.toBeUndefined();
  });
});

// ── Asset Graph tests ───────────────────────────────────────────────────────────

describe('AssetGraph — buildAssetRelationships', () => {
  test('builds expected edge types', () => {
    const rels = buildAssetRelationships({
      orgId:'org1', assetId:'asset1', jobId:'job1',
      campaignId:'camp1', brandId:'brand1', templateId:'tpl1',
      presetId:'pre1', archetypeId:'arch1',
    });
    const types = rels.map(r => r.relationship);
    expect(types).toContain('part_of_campaign');
    expect(types).toContain('belongs_to');
    expect(types).toContain('references_brand');
    expect(types).toContain('uses_template');
    expect(types).toContain('uses_preset');
    expect(types).toContain('uses_archetype');
    expect(types).toContain('produced_by_job');
  });

  test('all edges are org-scoped with provided orgId', () => {
    const rels = buildAssetRelationships({ orgId:'my_org', assetId:'a1', campaignId:'c1', brandId:'b1' });
    for (const r of rels) expect(r.orgId).toBe('my_org');
  });

  test('exploration_of edge added when explorationRunId present', () => {
    const rels = buildAssetRelationships({ orgId:'o1', assetId:'a1', explorationRunId:'run1' });
    expect(rels.some(r => r.relationship === 'exploration_of')).toBe(true);
    const edge = rels.find(r => r.relationship === 'exploration_of');
    expect(edge?.fromType).toBe('exploration_candidate');
  });

  test('no edges produced when no related entities', () => {
    const rels = buildAssetRelationships({ orgId:'o1', assetId:'a1' });
    expect(rels.length).toBe(0);
  });

  test('recordAssetRelationships does not throw with no prisma', async () => {
    const rels = buildAssetRelationships({ orgId:'o1', assetId:'a1', campaignId:'c1' });
    await expect(recordAssetRelationships(rels, noDeps)).resolves.toBeUndefined();
  });

  test('all edge weights are between 0 and 1', () => {
    const rels = buildAssetRelationships({ orgId:'o1', assetId:'a1', campaignId:'c1', brandId:'b1', templateId:'t1', presetId:'p1' });
    for (const r of rels) {
      expect(r.weight).toBeGreaterThanOrEqual(0);
      expect(r.weight).toBeLessThanOrEqual(1);
    }
  });
});

// ── Control Plane integration ───────────────────────────────────────────────────

describe('ControlPlane — integration', () => {
  test('initializeControlPlane is idempotent', () => {
    expect(() => {
      initializeControlPlane();
      initializeControlPlane();
      initializeControlPlane();
    }).not.toThrow();
  });

  test('registry is ready after initializeControlPlane', () => {
    initializeControlPlane();
    expect(() => assertRegistryReady()).not.toThrow();
  });

  test('all alwaysRun engines are enabled in a deterministic routing plan', () => {
    const plan = computeRoutingPlan(makeRoutingCtx({ plan: 'PRO' }));
    const alwaysRunEngines = ['IntentNormalization','LayoutIntelligence','AutoVariation','AudienceStyleEngine','ContentDensityOptimizer'];
    for (const name of alwaysRunEngines) {
      expect(plan.decisions.get(name)?.enabled).toBe(true);
    }
  });

  test('routing plan rationale is non-empty', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    expect(plan.rationale.length).toBeGreaterThan(0);
  });

  test('routing plan stage order covers all pipeline stages in order', () => {
    const plan = computeRoutingPlan(makeRoutingCtx());
    expect(plan.stageOrder[0]).toBe('pre_intent');
    expect(plan.stageOrder).toContain('intent');
    expect(plan.stageOrder).toContain('layout');
    expect(plan.stageOrder).toContain('brand');
    expect(plan.stageOrder).toContain('asset');
  });

  test('crash safety service can be created without prisma', () => {
    const svc = createCrashSafetyService(noDeps);
    expect(typeof svc.saveCheckpoint).toBe('function');
    expect(typeof svc.recoverFromCheckpoint).toBe('function');
    expect(typeof svc.transitionJob).toBe('function');
    expect(typeof svc.protectCredits).toBe('function');
    expect(typeof svc.sendToDeadLetter).toBe('function');
    expect(typeof svc.timeoutGuard).toBe('function');
  });
});
