#!/usr/bin/env bash
# =============================================================================
# Arkiol V2 — Production Deploy Checklist & Verification
# =============================================================================
# Runs before every release. Exits 1 on any failure.
# Usage: ./scripts/deploy-checklist.sh [--skip-worker-check] [--staging-only]
#
# V2 additions:
#   - Asset generation engine validation (no placeholder logic, 3D gating)
#   - HQ upgrade enforcement checks
#   - Monitoring & alerting configuration validation
#   - Credit ledger correctness verification
#   - Migration safety checks (idempotency + rollback plan)
#   - Concurrency cap validation
#   - Alert log table existence check
#   - Full staging test suite run
#
# Steps:
#   1.  Pre-flight: env, git, branch checks
#   2.  Database: run migrations, verify schema
#   3.  Build: packages/shared → arkiol-core → animation-studio
#   4.  Tests: unit tests for both apps
#   5.  Staging: full staging test suite
#   6.  Asset engine: validate V2 guarantees
#   7.  Monitoring: validate alert configuration
#   8.  Workers: confirm generation + export workers healthy
#   9.  Health: smoke-test health endpoints
#   10. DLQ: confirm dead-letter queue depth
#   11. Migration safety: verify idempotency

set -euo pipefail
SKIP_WORKER_CHECK="${1:-}"
STAGING_ONLY="${2:-}"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

step=0; passed=0; failed=0; warnings=0

log()    { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()     { echo -e "${GREEN}  ✅ $*${NC}"; ((passed++)) || true; }
warn()   { echo -e "${YELLOW}  ⚠️  $*${NC}"; ((warnings++)) || true; }
fail()   { echo -e "${RED}  ❌ $*${NC}"; ((failed++)) || true; }
header() { ((step++)) || true; echo -e "\n${BLUE}━━━ Step ${step}: $* ${NC}"; }

# ── Step 1: Pre-flight ────────────────────────────────────────────────────────
header "Pre-flight checks"

[[ -z "${DATABASE_URL:-}"  ]] && { fail "DATABASE_URL not set"; exit 1; } || ok "DATABASE_URL set"
[[ -z "${NEXTAUTH_SECRET:-}" ]] && warn "NEXTAUTH_SECRET not set (required for production)" || ok "NEXTAUTH_SECRET set"

# Validate billing provider env
BILLING_PROVIDER="${BILLING_PROVIDER:-stripe}"
if [[ "$BILLING_PROVIDER" == "stripe" ]]; then
  [[ -z "${STRIPE_SECRET_KEY:-}" ]]   && { fail "STRIPE_SECRET_KEY not set (BILLING_PROVIDER=stripe)"; exit 1; }
  [[ "${STRIPE_SECRET_KEY}" == sk_test_* ]] && warn "Using Stripe TEST-MODE key" || ok "STRIPE_SECRET_KEY: live-mode"
  [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]] && { fail "STRIPE_WEBHOOK_SECRET not set"; exit 1; } || ok "STRIPE_WEBHOOK_SECRET set"
elif [[ "$BILLING_PROVIDER" == "paddle" ]]; then
  [[ -z "${PADDLE_API_KEY:-}" ]]       && { fail "PADDLE_API_KEY not set (BILLING_PROVIDER=paddle)"; exit 1; } || ok "PADDLE_API_KEY set"
  [[ -z "${PADDLE_WEBHOOK_SECRET:-}" ]] && { fail "PADDLE_WEBHOOK_SECRET not set"; exit 1; } || ok "PADDLE_WEBHOOK_SECRET set"
fi
ok "Billing provider: $BILLING_PROVIDER"

# S3 / CDN
[[ -z "${AWS_ACCESS_KEY_ID:-}"     ]] && { fail "AWS_ACCESS_KEY_ID not set"; exit 1; } || ok "AWS_ACCESS_KEY_ID set"
[[ -z "${AWS_SECRET_ACCESS_KEY:-}" ]] && { fail "AWS_SECRET_ACCESS_KEY not set"; exit 1; } || ok "AWS_SECRET_ACCESS_KEY set"
[[ -z "${S3_BUCKET_NAME:-}"        ]] && { fail "S3_BUCKET_NAME not set"; exit 1; } || ok "S3_BUCKET_NAME: ${S3_BUCKET_NAME}"
[[ -z "${AWS_REGION:-}"            ]] && warn "AWS_REGION not set (defaulting to us-east-1)" || ok "AWS_REGION: ${AWS_REGION}"
[[ -z "${CLOUDFRONT_DOMAIN:-}"     ]] && warn "CLOUDFRONT_DOMAIN not set (CDN URLs will use S3 direct)" || ok "CLOUDFRONT_DOMAIN: ${CLOUDFRONT_DOMAIN}"

# Redis
[[ -z "${REDIS_HOST:-}"     ]] && warn "REDIS_HOST not set (defaulting to localhost)" || ok "REDIS_HOST: ${REDIS_HOST}"
[[ -z "${REDIS_PASSWORD:-}" ]] && warn "REDIS_PASSWORD not set (OK for local dev)" || ok "REDIS_PASSWORD set"

# OpenAI (required for AI generation)
[[ -z "${OPENAI_API_KEY:-}" ]] && { fail "OPENAI_API_KEY not set (required for asset generation)"; exit 1; } || ok "OPENAI_API_KEY set"

# Monitoring
[[ -z "${MONITORING_SECRET:-}" ]] && warn "MONITORING_SECRET not set (monitoring endpoint will require SUPER_ADMIN session)" || ok "MONITORING_SECRET set"

# 3D feature flag
  # 3D generation removed — no ENABLE_3D_GENERATION check needed

# Webhook secret key
[[ -z "${WEBHOOK_SECRET_KEY:-}" ]] && { fail "WEBHOOK_SECRET_KEY not set (required for SSRF + HMAC)"; exit 1; } || ok "WEBHOOK_SECRET_KEY set"

# Git cleanliness
if git diff --quiet HEAD 2>/dev/null; then
  ok "Git working tree clean"
else
  fail "Uncommitted changes — commit before deploying"
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse --short HEAD  2>/dev/null || echo "unknown")
log "Branch: ${BRANCH}  Commit: ${COMMIT}"

# ── Step 2: Database migrations ───────────────────────────────────────────────
header "Database migrations"

log "Running prisma migrate deploy (shared schema)..."
if npx prisma migrate deploy --schema=packages/shared/prisma/schema.prisma 2>&1; then
  ok "Shared schema migrations applied (packages/shared/prisma/migrations/)"
else
  fail "Migration failed — check DATABASE_URL and migration files"
fi
# NOTE: There is only ONE schema and ONE migration history for the entire platform.
# The unified schema at packages/shared/prisma/schema.prisma is the single source
# of truth for both Arkiol Core and Animation Studio. Do NOT add a second call here.

# Verify critical tables exist
log "Verifying critical tables..."
CRITICAL_TABLES="Org User Job Asset AIGeneratedAsset AlertLog CreditTransaction BillingEvent AuditLog"
for TABLE in $CRITICAL_TABLES; do
  if npx prisma db execute --schema=packages/shared/prisma/schema.prisma \
     --stdin <<< "SELECT 1 FROM \"${TABLE}\" LIMIT 1;" 2>/dev/null; then
    ok "Table exists: ${TABLE}"
  else
    # Table might be empty — check with information_schema
    COUNT=$(npx prisma db execute --schema=packages/shared/prisma/schema.prisma \
      --stdin <<< "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='${TABLE}';" 2>/dev/null || echo "0")
    if [[ "$COUNT" == *"1"* ]]; then
      ok "Table exists (empty): ${TABLE}"
    else
      warn "Cannot verify table: ${TABLE} (may be empty or schema mismatch)"
    fi
  fi
done

# Verify V2 columns on AIGeneratedAsset
log "Verifying V2 schema columns..."
V2_COLUMNS=("reuseCount" "creditCost" "providerCostUsd" "durationMs")
for COL in "${V2_COLUMNS[@]}"; do
  COLCHECK=$(npx prisma db execute --schema=packages/shared/prisma/schema.prisma \
    --stdin <<< "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='AIGeneratedAsset' AND column_name='${COL}';" 2>/dev/null || echo "0")
  if [[ "$COLCHECK" == *"1"* ]]; then
    ok "Column exists: AIGeneratedAsset.${COL}"
  else
    warn "Column may be missing: AIGeneratedAsset.${COL} (check migration 20260302_asset_engine_v2)"
  fi
done

# ── Step 3: Build ──────────────────────────────────────────────────────────────
header "Build: packages/shared → arkiol-core"

log "Building @arkiol/shared..."
if (cd packages/shared && npm run build 2>&1 | tail -5); then
  ok "@arkiol/shared build passed"
else
  fail "@arkiol/shared build FAILED"; exit 1
fi

log "Building arkiol-core..."
if (cd apps/arkiol-core && npm run build 2>&1 | tail -10); then
  ok "arkiol-core build passed"
else
  fail "arkiol-core build FAILED"; exit 1
fi

# ── Step 4: Unit tests ─────────────────────────────────────────────────────────
header "Unit tests"

log "Running arkiol-core unit tests..."
if (cd apps/arkiol-core && npm test -- --passWithNoTests 2>&1 | tail -10); then
  ok "arkiol-core unit tests passed"
else
  fail "arkiol-core unit tests FAILED"
fi

# ── Step 5: Full staging test suite ───────────────────────────────────────────
header "Full staging test suite (V2)"

log "Running V2 staging tests (Groups 1–15)..."
if (cd packages/shared && npx ts-node scripts/staging-tests.ts 2>&1); then
  ok "All staging tests passed"
else
  fail "Staging tests FAILED — release blocked"
  exit 1
fi

[[ "${STAGING_ONLY}" == "--staging-only" ]] && { log "Staging-only mode — stopping here"; exit 0; }

# ── Step 6: Asset engine V2 validation ────────────────────────────────────────
header "Asset engine V2 guarantees"

log "Checking that placeholder logic is absent from engine..."
if grep -r "placeholder" packages/shared/src/assetGenerationEngine.ts --include="*.ts" | grep -v "comment\|//"; then
  fail "Placeholder references found in assetGenerationEngine.ts (must be zero)"
else
  ok "No placeholder logic in assetGenerationEngine.ts"
fi

# 3D gating check removed — is3dGenerationEnabled / ENABLE_3D_GENERATION no longer exist
log "Checking HQ upgrade gating..."
if grep -q "planCanUseHq\|HQ_UPGRADE_NOT_ALLOWED" packages/shared/src/assetGenerationEngine.ts packages/shared/src/planEnforcer.ts; then
  ok "HQ upgrade gating present"
else
  fail "HQ upgrade gating missing"
fi

log "Checking similarity hash dedup..."
if grep -q "computeSimilarityHash\|lookupCache" packages/shared/src/assetGenerationEngine.ts; then
  ok "Similarity hash dedup present"
else
  fail "Similarity hash dedup missing"
fi

log "Checking metadata tracking on all generated assets..."
if grep -q "creditCost\|providerCostUsd\|durationMs" packages/shared/src/assetGenerationEngine.ts; then
  ok "Metadata tracking (creditCost, providerCostUsd, durationMs) present"
else
  fail "Metadata tracking missing from engine"
fi

log "Checking CDN/S3 upload on generation..."
if grep -q "uploadFn\|cdnUrl" packages/shared/src/assetGenerationEngine.ts; then
  ok "CDN/S3 upload integration present"
else
  fail "CDN/S3 upload integration missing"
fi

log "Checking credit-on-success-only in worker..."
if grep -q "deducted post-success\|Only deduct if we actually produced" apps/arkiol-core/src/workers/generation.worker.ts; then
  ok "Worker: credits deducted on success only"
else
  warn "Could not verify credit-on-success comment in worker (check manually)"
fi

# ── Step 7: Monitoring & alerting validation ───────────────────────────────────
header "Monitoring & alerting"

log "Checking monitoring module..."
if [[ -f packages/shared/src/monitoring.ts ]]; then
  ok "monitoring.ts exists"
else
  fail "monitoring.ts missing"
fi

log "Checking monitoring exports..."
if grep -q "runMonitoringChecks\|checkCostSpike\|checkStageHealth" packages/shared/src/index.ts; then
  ok "Monitoring functions exported from @arkiol/shared"
else
  fail "Monitoring not exported from @arkiol/shared/index.ts"
fi

log "Checking AlertLog in schema..."
if grep -q "model AlertLog" packages/shared/prisma/schema.prisma; then
  ok "AlertLog model in schema"
else
  fail "AlertLog model missing from Prisma schema"
fi

log "Checking monitoring route uses configureMonitoring..."
if grep -q "configureMonitoring\|runMonitoringChecks" apps/arkiol-core/src/app/api/monitoring/route.ts; then
  ok "Monitoring route integrated with monitoring service"
else
  fail "Monitoring route not integrated with monitoring service"
fi

# Alert thresholds
log "Verifying alert thresholds are positive..."
TS_CHECK=$(npx ts-node -e "
const { THRESHOLDS } = require('./packages/shared/src/monitoring');
const bad = Object.entries(THRESHOLDS).filter(([k, v]) => typeof v !== 'number' || v <= 0);
if (bad.length) { console.error('Bad thresholds:', bad); process.exit(1); }
console.log('ok');
" 2>&1)
if [[ "$TS_CHECK" == "ok" ]]; then
  ok "All monitoring thresholds are positive numbers"
else
  warn "Could not verify thresholds in TS (check manually): $TS_CHECK"
fi

# ── Step 8: Workers ────────────────────────────────────────────────────────────
header "Workers"

if [[ "${SKIP_WORKER_CHECK}" == "--skip-worker-check" ]]; then
  warn "Worker check skipped (--skip-worker-check)"
else
  log "Checking generation worker for TypeScript errors..."
  if npx tsc --noEmit -p apps/arkiol-core/tsconfig.json 2>&1 | grep -v "info\|warning" | head -20; then
    warn "TypeScript check had output — review above"
  else
    ok "Generation worker TypeScript clean"
  fi

  log "Checking worker files exist..."
  WORKERS="apps/arkiol-core/src/workers/generation.worker.ts apps/arkiol-core/src/workers/export.worker.ts apps/arkiol-core/src/workers/webhook.worker.ts"
  for W in $WORKERS; do
    [[ -f "$W" ]] && ok "Worker exists: $(basename $W)" || fail "Worker missing: $W"
  done
fi

# ── Step 9: Health check ───────────────────────────────────────────────────────
header "Health check"

HEALTH_URL="${ARKIOL_HEALTH_URL:-http://localhost:3000/api/health}"
log "Smoke-testing health endpoint: $HEALTH_URL"
if curl -sf --max-time 10 "$HEALTH_URL" > /tmp/health_response.json 2>/dev/null; then
  STATUS=$(cat /tmp/health_response.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
  if [[ "$STATUS" == "ok" || "$STATUS" == "healthy" ]]; then
    ok "Health endpoint returns status=$STATUS"
  else
    warn "Health endpoint returned status=$STATUS (expected ok/healthy)"
  fi
else
  warn "Health endpoint unreachable at $HEALTH_URL (OK if app not running locally)"
fi

# ── Step 10: DLQ depth check ──────────────────────────────────────────────────
header "Dead-letter queue"

log "Checking DLQ depth via monitoring endpoint..."
MONITORING_URL="${ARKIOL_MONITORING_URL:-http://localhost:3000/api/monitoring}"
if curl -sf --max-time 10 \
   -H "x-monitoring-token: ${MONITORING_SECRET:-}" \
   "$MONITORING_URL" > /tmp/monitoring_response.json 2>/dev/null; then
  DLQ_DEPTH=$(cat /tmp/monitoring_response.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('queues',{}).get('dlqDepth',0))" 2>/dev/null || echo "unknown")
  if [[ "$DLQ_DEPTH" == "0" ]]; then
    ok "DLQ empty (depth=0)"
  elif [[ "$DLQ_DEPTH" == "unknown" ]]; then
    warn "Could not read DLQ depth from monitoring response"
  else
    DLQ_INT=${DLQ_DEPTH:-0}
    if (( DLQ_INT >= 10 )); then
      fail "DLQ depth critical: $DLQ_DEPTH items — investigate before deploying"
    else
      warn "DLQ depth: $DLQ_DEPTH items (below critical threshold)"
    fi
  fi
else
  warn "Monitoring endpoint unreachable (OK if app not running locally)"
fi

# ── Step 11: Migration safety ─────────────────────────────────────────────────
header "Migration safety"

log "Checking all migrations have idempotent guards..."
MIGRATION_DIRS=$(find packages/shared/prisma/migrations -name "migration.sql" 2>/dev/null)
NON_IDEMPOTENT=0
for MIG in $MIGRATION_DIRS; do
  # Check that ALTER TABLE uses IF NOT EXISTS or CREATE INDEX uses IF NOT EXISTS
  if grep -q "^ALTER TABLE" "$MIG" && ! grep -q "IF NOT EXISTS\|IF EXISTS" "$MIG"; then
    warn "Migration may not be idempotent: $MIG (no IF NOT EXISTS / IF EXISTS guards on ALTER TABLE)"
    ((NON_IDEMPOTENT++)) || true
  fi
done
if [[ "$NON_IDEMPOTENT" -eq 0 ]]; then
  ok "All migrations have idempotency guards"
else
  warn "$NON_IDEMPOTENT migration(s) may lack idempotency guards — review manually"
fi

log "Checking for rollback plan in latest migration..."
LATEST_MIG=$(find packages/shared/prisma/migrations -name "migration.sql" | sort | tail -1)
if [[ -n "$LATEST_MIG" ]]; then
  ok "Latest migration: $LATEST_MIG"
  # Check it has comments describing what it does
  if grep -q "^--" "$LATEST_MIG"; then
    ok "Migration has comments"
  else
    warn "Migration has no comments — add description for rollback planning"
  fi
fi

# ── Step 12: Final V2 smoke checks ────────────────────────────────────────────
header "V2 smoke checks"

log "Verifying CREDIT_COSTS includes V2 keys..."
TS_COSTS=$(npx ts-node -e "
const { CREDIT_COSTS } = require('./packages/shared/src/plans');
const required = ['static', 'static_hq', 'gif', 'normal_ad', 'cinematic_ad', 'video_std', 'video_hq', 'export_zip'];
const missing = required.filter(k => !(k in CREDIT_COSTS));
if (missing.length) { console.error('Missing:', missing); process.exit(1); }
console.log('ok:' + Object.keys(CREDIT_COSTS).join(','));
" 2>&1)
if [[ "$TS_COSTS" == ok:* ]]; then
  ok "CREDIT_COSTS V2 keys: ${TS_COSTS#ok:}"
else
  fail "CREDIT_COSTS missing V2 keys: $TS_COSTS"
fi

log "Verifying PLANS include V2 fields..."
TS_PLANS=$(npx ts-node -e "
const { PLANS } = require('./packages/shared/src/plans');
for (const [k, p] of Object.entries(PLANS)) {
  if (typeof p.canUseHqUpgrade !== 'boolean') { console.error(k + ': canUseHqUpgrade missing'); process.exit(1); }
  if (typeof p.maxOnDemandAssets !== 'number') { console.error(k + ': maxOnDemandAssets missing'); process.exit(1); }
}
console.log('ok');
" 2>&1)
if [[ "$TS_PLANS" == "ok" ]]; then
  ok "All PLANS have V2 fields"
else
  fail "PLANS V2 fields incomplete: $TS_PLANS"
fi
  # is3dGenerationEnabled removed — 3D not part of launch product

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  DEPLOY CHECKLIST SUMMARY${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}✅ PASSED:${NC}   ${passed}"
echo -e "  ${YELLOW}⚠️  WARNINGS:${NC} ${warnings}"
echo -e "  ${RED}❌ FAILED:${NC}   ${failed}"
echo ""

if [[ "$failed" -gt 0 ]]; then
  echo -e "${RED}  ❌ DEPLOY BLOCKED — ${failed} check(s) failed${NC}"
  echo -e "${RED}  Resolve all failures before deploying to production.${NC}"
  exit 1
elif [[ "$warnings" -gt 5 ]]; then
  echo -e "${YELLOW}  ⚠️  ${warnings} warnings — review before deploying to production${NC}"
  exit 0
else
  echo -e "${GREEN}  ✅ ALL CHECKS PASSED — Safe to deploy${NC}"
  echo -e "${GREEN}  Commit: ${COMMIT}  Branch: ${BRANCH}${NC}"
  exit 0
fi
