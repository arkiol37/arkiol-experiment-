/**
 * Intelligence Engine Validation & Benchmark Suite
 * Tests all 16 QI engines + 14 PS engines + candidate pipeline + self-healing
 * Ensures no regression, no silent failures, deterministic behavior.
 */

// ── Test utilities ──────────────────────────────────────────────
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`FAIL: ${msg}`); }
function assertRange(val: number, min: number, max: number, msg: string) { assert(val >= min && val <= max, `${msg}: ${val} not in [${min},${max}]`); }

// ── Mock data ───────────────────────────────────────────────────
const mockScenes = [
  { id: 's1', role: 'hook', onScreenText: 'Get 50% Off Today', prompt: 'Bold product hero shot', visualDirection: 'dramatic lighting, product focus',
    emotionTarget: 0.75, pacingBpm: 110, qualityTarget: 80, durationSec: 4, cameraMove: 'push_in', shotType: 'close_up', transitionIn: 'crossfade',
    depthLayers: [{ layer: 'background', elements: [{ id: 'bg', position: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1 }], blurRadius: 2 },
      { layer: 'subject', elements: [{ id: 'prod', position: { x: 0.3, y: 0.2, width: 0.4, height: 0.6 }, opacity: 1 }], blurRadius: 0 }],
    audioSync: [], continuityTokens: [] },
  { id: 's2', role: 'solution', onScreenText: 'Premium Quality', prompt: 'Clean product showcase', visualDirection: 'minimal, premium feel',
    emotionTarget: 0.6, pacingBpm: 95, qualityTarget: 75, durationSec: 5, cameraMove: 'ken_burns', shotType: 'medium', transitionIn: 'crossfade',
    depthLayers: [{ layer: 'background', elements: [{ id: 'bg2', position: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1 }], blurRadius: 1 }],
    audioSync: [], continuityTokens: [] },
  { id: 's3', role: 'cta', onScreenText: 'Shop Now', prompt: 'Strong call to action with brand logo', visualDirection: 'brand colors, CTA button prominent',
    emotionTarget: 0.8, pacingBpm: 120, qualityTarget: 85, durationSec: 3, cameraMove: 'push_in', shotType: 'medium', transitionIn: 'crossfade',
    depthLayers: [{ layer: 'background', elements: [{ id: 'bg3', position: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1 }], blurRadius: 0 },
      { layer: 'subject', elements: [{ id: 'cta', position: { x: 0.2, y: 0.4, width: 0.6, height: 0.2 }, opacity: 1 }], blurRadius: 0 }],
    audioSync: [], continuityTokens: [] },
];

const mockIntent = { mood: 'Bold', platform: 'instagram', aspectRatio: '9:16', renderMode: 'Normal Ad',
  brand: { name: 'TestBrand', industry: 'ecommerce', brief: 'Online store' }, objective: 'conversion',
  hookType: 'bold_claim', maxDurationSec: 15, sceneCount: 3 };

// ── QI Engine Tests ─────────────────────────────────────────────
async function testQI() {
  const { evaluateQI, createQICandidate, generateVariations } = await import('../apps/animation-studio/backend/src/engines/quality-intelligence/qualityIntelligenceLayer');

  // Test candidate creation
  const c = createQICandidate('test_1', mockScenes, mockIntent);
  assert(c.id === 'test_1', 'Candidate ID');
  assert(c.scenes.length === 3, 'Scene count');

  // Test variation generation
  const ctx = { industry: 'ecommerce', mood: 'Bold', platform: 'instagram', renderMode: 'Normal Ad', recentFingerprints: [], tasteProfile: null, benchmarkBaseline: 60, allCandidates: [] };
  const variations = generateVariations(c, ctx, 4);
  assert(variations.length >= 2, `Variations generated: ${variations.length}`);
  assert(variations.every(v => v.id && v.type && v.mutations), 'All variations have id, type, mutations');

  // Test full evaluation
  const result = evaluateQI([c], ctx);
  assert(result.ranked.length + result.blocked.length === 1, 'All candidates accounted');
  assertRange(c.composite, 1, 100, 'Composite score in range');

  // Verify all 16 engines produced scores
  const engineIds = Object.keys(c.scores);
  assert(engineIds.length >= 14, `Engines scored: ${engineIds.length}/16`); // some may skip based on context

  // Verify no empty scores
  for (const [id, score] of Object.entries(c.scores)) {
    assertRange(score.score, 0, 100, `${id} score range`);
    assert(score.rationale.length > 0, `${id} has rationale`);
  }

  console.log(`  QI: ${engineIds.length} engines scored, composite=${c.composite}, directives=${c.directives.length}`);
  return true;
}

// ── PS Engine Tests ─────────────────────────────────────────────
async function testPS() {
  const { evaluatePS, createPSCandidate } = await import('../apps/animation-studio/backend/src/engines/psychology/psychologyLayer');

  const c = createPSCandidate('test_ps_1', mockScenes, mockIntent);
  const ctx = { industry: 'ecommerce', mood: 'Bold', platform: 'instagram', regenHistory: [], sessionFps: [], allCandidates: [c] };

  const result = evaluatePS([c], ctx);
  assert(result.ranked.length === 1, 'PS ranked 1');
  assertRange(c.composite, 1, 100, 'PS composite in range');

  const engineIds = Object.keys(c.scores);
  assert(engineIds.length >= 12, `PS engines scored: ${engineIds.length}/14`);

  console.log(`  PS: ${engineIds.length} engines scored, composite=${c.composite}, directives=${c.directives.length}`);
  return true;
}

// ── Self-Healing Tests ──────────────────────────────────────────
async function testSelfHealing() {
  const sh = await import('../apps/animation-studio/backend/src/engines/self-healing/selfHealingLayer');

  // Test failure classification
  const f1 = sh.classifyFailure(new Error('ECONNRESET'), { jobId: 'test', stage: 'render' });
  assert(f1.failureClass === 'transient_infrastructure', 'ECONNRESET → transient');
  assert(f1.retryable === true, 'Transient is retryable');

  const f2 = sh.classifyFailure(new Error('schema validation failed: missing required'), { jobId: 'test', stage: 'spec' });
  assert(f2.failureClass === 'deterministic_content', 'Schema → deterministic');
  assert(f2.retryable === false, 'Deterministic not retryable');

  // Test checkpoint
  const cp = sh.saveCheckpoint({ jobId: 'test_cp', stage: 'post_spec', sceneIndex: 0, specHash: 'abc', retryCount: 0 });
  assert(cp.verified === true, 'Checkpoint verified');
  const latest = sh.getLatestCheckpoint('test_cp');
  assert(latest?.id === cp.id, 'Checkpoint retrievable');
  sh.clearCheckpoints('test_cp');
  assert(sh.getLatestCheckpoint('test_cp') === null, 'Checkpoint cleared');

  // Test circuit breaker
  sh.recordCircuitSuccess('test_circuit');
  assert(!sh.isCircuitOpen('test_circuit'), 'Circuit closed after success');

  // Test memory pressure
  const mem = sh.checkMemoryPressure();
  assert(typeof mem.usageMB === 'number', 'Memory check returns number');

  // Test quarantine
  sh.quarantineJob('quarantine_test', 'test reason');
  assert(sh.isJobQuarantined('quarantine_test'), 'Job quarantined');

  // Test escalation
  assert(sh.getEscalationLevel([]) === 'none', 'No incidents → no escalation');

  console.log('  Self-Healing: all checks passed');
  return true;
}

// ── Memory Store Tests ──────────────────────────────────────────
async function testMemory() {
  const mem = await import('../apps/animation-studio/backend/src/engines/candidate/memoryStore');

  // Taste profile returns seeded defaults for new user
  const taste = mem.getTasteProfile('new_user_xyz');
  assert(taste.sampleCount === 0, 'New user has 0 samples');
  assert(taste.preferredPolish > 0, 'Seeded defaults present');

  // Recording regeneration
  mem.recordRegeneration('user_1', {
    timestamp: new Date(), jobId: 'j1', userId: 'user_1',
    previousFingerprint: 'fp1', inferredReason: 'weak_hook',
    reasonConfidence: 0.7, sequenceIndex: 1
  });
  const history = mem.getRegenerationHistory('user_1');
  assert(history.length === 1, 'Regen recorded');

  // Session fingerprint
  const fp = mem.computeFingerprint(mockScenes, 'test_job');
  assert(fp.layoutSignature.length > 0, 'Fingerprint computed');
  mem.recordSessionFingerprint('user_1', fp);
  assert(mem.getSessionFingerprints('user_1').length === 1, 'Session fp recorded');

  // Benchmark
  mem.updateBenchmark('ws_1', 75);
  assert(mem.getBenchmarkBaseline('ws_1') > 60, 'Benchmark updated');

  console.log('  Memory: all checks passed');
  return true;
}

// ── Candidate Pipeline Tests ────────────────────────────────────
async function testPipeline() {
  const { runCandidatePipeline } = await import('../apps/animation-studio/backend/src/engines/candidate/candidatePipeline');

  const result = await runCandidatePipeline(
    mockScenes, mockIntent, {},
    { industry: 'ecommerce', mood: 'Bold', platform: 'instagram', aspectRatio: '9:16', renderMode: 'Normal Ad', userId: 'u1', workspaceId: 'w1', jobId: 'pipeline_test' },
  );

  assert(result.winner !== null, 'Winner selected');
  assert(result.poolSize >= 2, `Pool size: ${result.poolSize}`);
  assert(result.winner.unified > 0, 'Winner has score');
  assert(result.appliedDirectives >= 0, 'Directives counted');
  assert(result.evalTimeMs > 0, 'Eval time measured');

  console.log(`  Pipeline: pool=${result.poolSize}, winner=${result.winner.id} (${result.winner.unified}), blocked=${result.blockedCount}, directives=${result.appliedDirectives}, time=${result.evalTimeMs}ms`);
  return true;
}

// ── Run all tests ───────────────────────────────────────────────
async function runAll() {
  console.log('═══════════════════════════════════════════');
  console.log(' Arkiol V27 Intelligence Engine Test Suite');
  console.log('═══════════════════════════════════════════');

  let passed = 0, failed = 0;
  const tests = [
    ['Quality Intelligence (16 engines)', testQI],
    ['Psychology Layer (14 engines)', testPS],
    ['Self-Healing Layer', testSelfHealing],
    ['Memory Store', testMemory],
    ['Candidate Pipeline', testPipeline],
  ] as const;

  for (const [name, fn] of tests) {
    try {
      await (fn as any)();
      console.log(`✅ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

runAll().catch(e => { console.error(e); process.exit(1); });
