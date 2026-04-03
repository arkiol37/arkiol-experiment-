// packages/shared/src/index.ts
// Public API of @arkiol/shared.
// Apps import ONLY from this barrel — never from internal files directly.

export * from './plans';
export * from './credits';
export * from './planEnforcer';
export * from './jobLifecycle';
export * from './stripeWebhooks';
export * from './autoRefill';
export * from './crons';

// ── Hardening additions ────────────────────────────────────────────────────
// (1) Centralized env validation — import and call validateSharedEnv() at startup
export * from './env';
// (2) SSRF guard for outbound webhook URL validation
export * from './webhookSsrfGuard';
// (3) Export job idempotency protection
export * from './exportIdempotency';
// (4) Per-user/org concurrency enforcement at DB layer
export * from './concurrencyEnforcer';
// (5) Structured audit logging service
export * from './auditLogger';
// (6) Soft-delete service for StudioProjects
export * from './softDelete';

// ── V16 additions ──────────────────────────────────────────────────────────
// (7) BillingProvider abstraction — BILLING_PROVIDER=paddle|stripe
export * from './billingProvider';
// (8) Paddle webhook handler
export * from './paddleWebhooks';
// (9) Structured AI intelligence layers
export * from './aiIntelligence';
// (10) On-Demand Asset Generation Engine
export * from './assetGenerationEngine';
// (11) AI feedback loops, A/B learning, adaptive refinement
export * from './aiLearning';
// (12) Benchmarking metrics, performance scoring, A/B result capture
export * from './benchmarking';
// (13) Structured metadata storage — continuous improvement engine
export * from './metadataStore';
// (14) Stage trace persistence — per-stage timing, decisions, fallback reasons
export * from './stageTrace';

// ── V17 additions ──────────────────────────────────────────────────────────
// (15) Brand Learning — org-scoped, passive, feature-flag gated
export * from './brandLearning';

// ── V2 additions ────────────────────────────────────────────────────────────
// (16) Monitoring & Alerting — cost spikes, volume anomalies, stage failures
export * from './monitoring';

// ── Archetype + Preset Intelligence System ───────────────────────────────────
// (17) All 20 archetypes, 5 style presets, and the intelligence selection engine
export * from './ai/archetypes';

// ── V9 additions ─────────────────────────────────────────────────────────────
// (18) V9 shared types for platform intelligence, cost monitor, queue records
export * from './v9Types';

// ── Formal AI Engine Control Plane ───────────────────────────────────────────
// (19) Engine Registry — centralized contract-based registry for all AI engines
export * from './engineRegistry';
// (20) Policy Router — dynamic routing above the pipeline orchestrator
export * from './policyRouter';
// (21) Unified Memory Layer — controlled read/write for all learning signals
export * from './unifiedMemory';
// (22) Asset Graph — relationship mapping between all platform entities
export * from './assetGraph';
// (23) Versioned Evaluation — benchmarking, A/B tracking, version attribution
export * from './versionedEvaluation';
// (24) Crash Safety — retry, checkpoint recovery, credit protection, DLQ
export * from './crashSafety';
// (25) Control Plane Orchestrator — top-level integration wiring all systems
export * from './controlPlane';

// ── Production Hardening ──────────────────────────────────────────────────────
// (26) Parallel Orchestrator — group-based concurrent stage execution
export * from './parallelOrchestrator';
// (27) Atomic Credit Protection — two-phase commit with hold/finalize/refund
export * from './atomicCreditProtection';
// (28) Idempotency Guard — stage, asset, and credit-level deduplication
export * from './idempotencyGuard';
// (29) Observability — structured logging, tracing, metrics, health checks
export * from './observability';
export * from './capabilities';

// ── V20 additions ──────────────────────────────────────────────────────────
// Cross-app schemas
export * from './schemas/creativeIntentSchema';
export * from './schemas/brandAssetSchema';
export * from './schemas/sceneSchema';
export * from './schemas/timelineSchema';
export * from './schemas/renderJobSchema';
export * from './schemas/continuitySchema';
// Quality & analytics
export * from './qc/qualityGate';
export * from './analytics/renderAnalytics';
export * from './analytics/renderFunnel';
export * from './analytics/adPerformance';
// Providers
export * from './providers/providerCapabilityMatrix';
export * from './providers/providerFallbackPolicy';
// Infrastructure
export * from './events/eventBus';
export * from './render/exportProfiles';
export * from './orchestration/projectStateOrchestrator';
export * from './config/featureFlags';
export * from './billing/usagePolicy';
export * from './brand/assetRegistry';
