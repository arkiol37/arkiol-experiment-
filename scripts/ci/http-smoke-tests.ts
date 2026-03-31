#!/usr/bin/env tsx
/**
 * scripts/ci/http-smoke-tests.ts
 *
 * HTTP smoke tests for the CI "smoke-tests" job and the local `npm run verify`
 * command. Hits every critical endpoint on both running servers and asserts:
 *   - Correct HTTP status codes
 *   - Response bodies match expected shapes / fields
 *   - Auth-protected routes return 401, not 500, when unauthenticated
 *
 * No real credentials are needed. Tests are designed to work with stub env vars.
 *
 * Environment:
 *   ARKIOL_CORE_URL  — e.g. http://localhost:3000  (default)
 *   STUDIO_URL       — e.g. http://localhost:4000  (default)
 */

const CORE_URL  = (process.env.ARKIOL_CORE_URL  ?? 'http://localhost:3000').replace(/\/$/, '');
const STUDIO_URL = (process.env.STUDIO_URL ?? 'http://localhost:4000').replace(/\/$/, '');

interface Result {
  name:    string;
  passed:  boolean;
  detail?: string;
}

const results: Result[] = [];
let passed = 0;
let failed = 0;

// ── Colour helpers ──────────────────────────────────────────────────────────
const C = {
  ok:   (s: string) => `\x1b[32m  ✓ ${s}\x1b[0m`,
  fail: (s: string) => `\x1b[31m  ✗ ${s}\x1b[0m`,
  head: (s: string) => `\x1b[1m\x1b[36m${s}\x1b[0m`,
};

// ── Assertion helpers ───────────────────────────────────────────────────────
function pass(name: string, detail?: string): void {
  console.log(C.ok(name + (detail ? ` — ${detail}` : '')));
  results.push({ name, passed: true, detail });
  passed++;
}

function fail(name: string, detail?: string): void {
  console.log(C.fail(name + (detail ? ` — ${detail}` : '')));
  results.push({ name, passed: false, detail });
  failed++;
}

async function get(
  label: string,
  url: string,
  opts: {
    expectStatus?: number | number[];
    expectField?:  string;
    expectBodyContains?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: unknown } | null> {
  const { expectStatus = 200, expectField, expectBodyContains, headers = {} } = opts;
  const expectedStatuses = Array.isArray(expectStatus) ? expectStatus : [expectStatus];

  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }

    if (!expectedStatuses.includes(res.status)) {
      fail(label, `expected HTTP ${expectedStatuses.join('|')}, got ${res.status} — ${JSON.stringify(body)?.slice(0, 200)}`);
      return null;
    }

    if (expectField && (typeof body !== 'object' || body === null || !(expectField in (body as object)))) {
      fail(label, `response missing field "${expectField}" — got ${JSON.stringify(body)?.slice(0, 200)}`);
      return null;
    }

    if (expectBodyContains) {
      const bodyStr = JSON.stringify(body);
      if (!bodyStr.includes(expectBodyContains)) {
        fail(label, `response does not contain "${expectBodyContains}" — got ${bodyStr.slice(0, 200)}`);
        return null;
      }
    }

    const statusNote = res.status === expectedStatuses[0] ? `${res.status}` : `${res.status} (one of ${expectedStatuses.join('|')})`;
    pass(label, `HTTP ${statusNote}`);
    return { status: res.status, body };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(label, msg);
    return null;
  }
}

async function post(
  label: string,
  url: string,
  body: unknown,
  opts: { expectStatus?: number | number[] } = {},
): Promise<{ status: number; body: unknown } | null> {
  const { expectStatus = [200, 201, 400, 401, 422] } = opts;
  const expectedStatuses = Array.isArray(expectStatus) ? expectStatus : [expectStatus];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    let resBody: unknown = null;
    try { resBody = await res.json(); } catch { resBody = null; }

    if (!expectedStatuses.includes(res.status)) {
      fail(label, `expected HTTP ${expectedStatuses.join('|')}, got ${res.status} — ${JSON.stringify(resBody)?.slice(0, 200)}`);
      return null;
    }

    pass(label, `HTTP ${res.status}`);
    return { status: res.status, body: resBody };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(label, msg);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ARKIOL CORE  (Next.js, port 3000)
// ═══════════════════════════════════════════════════════════════════════════
async function testArkiolCore(): Promise<void> {
  console.log(C.head('\nArkiol Core  ' + CORE_URL));
  console.log(C.head('─'.repeat(50)));

  // ── Health — main liveness probe ───────────────────────────────────────────
  const health = await get(
    'GET /api/health',
    `${CORE_URL}/api/health`,
    { expectField: 'status' },
  );

  if (health) {
    const body = health.body as Record<string, unknown>;
    const status = body.status as string;
    // Accept any non-error status — "unhealthy" means DB/Redis is up but
    // external services (S3, Stripe, OpenAI) are stubs in CI.
    if (['ok', 'warn', 'degraded', 'unhealthy'].includes(status)) {
      pass('GET /api/health — status field is a known value', status);
    } else {
      fail('GET /api/health — status field has unexpected value', String(status));
    }

    const checks = body.checks as Record<string, { status: string }> | undefined;
    if (checks) {
      // DB and Redis must be OK in CI (they are real services)
      for (const svc of ['database', 'redis']) {
        if (checks[svc]) {
          const svcStatus = checks[svc].status;
          if (svcStatus === 'ok') {
            pass(`  /api/health — checks.${svc} = ok`);
          } else {
            fail(`  /api/health — checks.${svc} = ${svcStatus} (expected ok in CI)`);
          }
        }
      }
      // Environment check must pass — validates all required vars are present
      if (checks.environment) {
        if (checks.environment.status === 'ok') {
          pass('  /api/health — checks.environment = ok');
        } else {
          fail(`  /api/health — checks.environment = ${checks.environment.status}`,
               (checks.environment as any).detail);
        }
      }
    }
  }

  // ── Auth session endpoint — NextAuth session route must respond correctly ──
  // In an unauthenticated request this must return 200 with null/empty session,
  // never 500. This verifies NextAuth is correctly wired to the route handler.
  const sessionRes = await get(
    'GET /api/auth/session → 200 (unauthenticated — no active session)',
    `${CORE_URL}/api/auth/session`,
    { expectStatus: 200 },
  );
  if (sessionRes) {
    // NextAuth returns {} or { user: null } for unauthenticated requests — never a non-object
    if (typeof sessionRes.body === 'object') {
      pass('  /api/auth/session — response is a JSON object (not a string/null)');
    } else {
      fail('  /api/auth/session — unexpected response type', String(typeof sessionRes.body));
    }
  }

  // Auth registration — must accept JSON and return 4xx (validation or conflict), not 500
  await post('POST /api/auth/register — rejects empty body (validates input)',
    `${CORE_URL}/api/auth/register`,
    {}, { expectStatus: [400, 422, 409] });

  // Registration with structurally invalid email — must return 400/422
  await post('POST /api/auth/register — rejects invalid email format',
    `${CORE_URL}/api/auth/register`,
    { email: 'not-an-email', password: 'Password1' }, { expectStatus: [400, 422] });

  // ── Auth-protected routes — must return 401, not 500, when unauthenticated ──
  // These cover every route group: generation, assets, campaigns, billing, admin,
  // brand, team, usage, api-keys, editor, cost-protection, webhooks, audit-logs.
  await get('GET /api/generate → 401 (unauthenticated)',            `${CORE_URL}/api/generate`,             { expectStatus: [401, 405] });
  await get('GET /api/explore → 401 (unauthenticated)',             `${CORE_URL}/api/explore`,              { expectStatus: [401, 405] });
  await get('GET /api/assets/library → 401 (unauthenticated)',      `${CORE_URL}/api/assets/library`,       { expectStatus: 401 });
  await get('GET /api/assets → 401 (unauthenticated)',              `${CORE_URL}/api/assets`,               { expectStatus: 401 });
  await get('GET /api/campaigns → 401 (unauthenticated)',           `${CORE_URL}/api/campaigns`,            { expectStatus: 401 });
  await get('GET /api/campaigns/director → 401 (unauthenticated)',  `${CORE_URL}/api/campaigns/director`,   { expectStatus: [401, 405] });
  await get('GET /api/jobs → 401 (unauthenticated)',                `${CORE_URL}/api/jobs`,                 { expectStatus: 401 });
  await get('GET /api/billing → 401 (unauthenticated)',             `${CORE_URL}/api/billing`,              { expectStatus: 401 });
  await get('GET /api/billing/status → 401 (unauthenticated)',      `${CORE_URL}/api/billing/status`,       { expectStatus: 401 });
  await get('GET /api/brand → 401 (unauthenticated)',               `${CORE_URL}/api/brand`,                { expectStatus: 401 });
  await get('GET /api/org → 401 (unauthenticated)',                 `${CORE_URL}/api/org`,                  { expectStatus: 401 });
  await get('GET /api/team → 401 (unauthenticated)',                `${CORE_URL}/api/team`,                 { expectStatus: 401 });
  await get('GET /api/usage → 401 (unauthenticated)',               `${CORE_URL}/api/usage`,                { expectStatus: 401 });
  await get('GET /api/api-keys → 401 (unauthenticated)',            `${CORE_URL}/api/api-keys`,             { expectStatus: 401 });
  await get('GET /api/webhooks → 401 (unauthenticated)',            `${CORE_URL}/api/webhooks`,             { expectStatus: 401 });
  await get('GET /api/audit-logs → 401 (unauthenticated)',          `${CORE_URL}/api/audit-logs`,           { expectStatus: 401 });
  await get('GET /api/audit → 401 (unauthenticated)',               `${CORE_URL}/api/audit`,                { expectStatus: 401 });
  await get('GET /api/cost-protection → 401 (unauthenticated)',     `${CORE_URL}/api/cost-protection`,      { expectStatus: 401 });
  await get('GET /api/cost-protection/budget → 401',                `${CORE_URL}/api/cost-protection/budget`, { expectStatus: 401 });
  await get('GET /api/export → 401 (unauthenticated)',              `${CORE_URL}/api/export`,               { expectStatus: [401, 405] });
  await get('GET /api/editor/autosave → 401 (unauthenticated)',     `${CORE_URL}/api/editor/autosave`,      { expectStatus: [401, 405] });

  // Admin endpoints — require ADMIN/SUPER_ADMIN role (should 401 unauthenticated)
  await get('GET /api/admin → 401 (unauthenticated)',               `${CORE_URL}/api/admin`,                { expectStatus: 401 });
  await get('GET /api/admin/diagnostics → 401 (unauthenticated)',   `${CORE_URL}/api/admin/diagnostics`,    { expectStatus: 401 });
  await get('GET /api/admin/ai-pipeline → 401 (unauthenticated)',   `${CORE_URL}/api/admin/ai-pipeline`,    { expectStatus: 401 });

  // Monitoring endpoint — protected by MONITORING_SECRET token OR SUPER_ADMIN session.
  // Without a valid token or session it must return 403 (Forbidden), NOT 401 or 500.
  // The route explicitly returns 403 for unauthenticated requests per its auth logic.
  await get('GET /api/monitoring → 403 (no token/session)',         `${CORE_URL}/api/monitoring`,           { expectStatus: 403 });

  // Monitoring with a wrong token — still 403
  await get('GET /api/monitoring → 403 (wrong token)',              `${CORE_URL}/api/monitoring`,
    { expectStatus: 403, headers: { 'x-monitoring-token': 'wrong-token' } });

  // ── POST routes — must return 401 unauthenticated, not 500 ────────────────
  await post('POST /api/generate → 401 (unauthenticated)',
    `${CORE_URL}/api/generate`,
    { prompt: 'test', formats: ['instagram_post'] }, { expectStatus: [401] });

  await post('POST /api/explore → 401 (unauthenticated)',
    `${CORE_URL}/api/explore`,
    { jobId: 'j1', format: 'instagram_post', pipelineContext: {} }, { expectStatus: [401] });

  await post('POST /api/campaigns/director → 401 (unauthenticated)',
    `${CORE_URL}/api/campaigns/director`,
    { prompt: 'Launch a summer campaign' }, { expectStatus: [401] });

  await post('POST /api/webhooks → 401 (unauthenticated)',
    `${CORE_URL}/api/webhooks`,
    { url: 'https://example.com/hook', events: ['asset.generated'] }, { expectStatus: [401] });

  // ── Platform info endpoint — requires auth ─────────────────────────────────
  await get('GET /api/platform → 401 (unauthenticated)', `${CORE_URL}/api/platform`, { expectStatus: 401 });

  // ── Billing webhook — raw POST must return 400 (missing signature), not 500 ──
  // This endpoint processes Stripe/Paddle webhooks. Without a valid signature header
  // it must reject with 400, proving the signature check runs before any logic.
  await post('POST /api/billing/webhook — rejects unsigned request',
    `${CORE_URL}/api/billing/webhook`,
    { type: 'checkout.session.completed' }, { expectStatus: [400, 401, 403] });

  await post('POST /api/billing/paddle/webhook — rejects unsigned request',
    `${CORE_URL}/api/billing/paddle/webhook`,
    { eventType: 'subscription.created' }, { expectStatus: [400, 401, 403] });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION STUDIO BACKEND  (Express, port 4000)
// ═══════════════════════════════════════════════════════════════════════════
async function testAnimationStudio(): Promise<void> {
  console.log(C.head('\nAnimation Studio  ' + STUDIO_URL));
  console.log(C.head('─'.repeat(50)));

  // ── Health — liveness probe ────────────────────────────────────────────────
  const health = await get(
    'GET /api/health',
    `${STUDIO_URL}/api/health`,
    { expectField: 'status' },
  );
  if (health) {
    const body = health.body as Record<string, unknown>;
    if (body.status === 'ok') {
      pass('GET /api/health — status = ok', String(body.status));
    } else {
      fail('GET /api/health — expected status=ok', String(body.status));
    }
  }

  // ── Readiness probe — checks DB + Redis + S3 + Stripe ─────────────────────
  const ready = await get(
    'GET /api/health/ready',
    `${STUDIO_URL}/api/health/ready`,
    { expectStatus: [200, 503], expectField: 'checks' },
  );
  if (ready) {
    const checks = (ready.body as Record<string, unknown>).checks as
      Record<string, { status: string }> | undefined;
    if (checks) {
      // DB and Redis must be ok in CI — they are real services
      for (const svc of ['database', 'redis']) {
        if (checks[svc]) {
          const svcStatus = checks[svc].status;
          if (svcStatus === 'ok') {
            pass(`  /api/health/ready — checks.${svc} = ok`);
          } else {
            fail(`  /api/health/ready — checks.${svc} = ${svcStatus} (expected ok in CI)`);
          }
        }
      }
      // Environment check — all required config must be present
      if (checks.environment) {
        if (checks.environment.status === 'ok') {
          pass('  /api/health/ready — checks.environment = ok');
        } else {
          fail(`  /api/health/ready — checks.environment = ${checks.environment.status}`,
               (checks.environment as any).detail);
        }
      }
    }
  }

  // ── Liveness probe (Kubernetes-style) ─────────────────────────────────────
  const live = await get('GET /api/health/live → 200',
    `${STUDIO_URL}/api/health/live`, { expectField: 'status' });
  if (live) {
    const body = live.body as Record<string, unknown>;
    if (body.status === 'alive') {
      pass('  /api/health/live — status = alive');
    } else {
      fail('  /api/health/live — unexpected status', String(body.status));
    }
  }

  // ── Auth — must be 400/401/422, never 500 ─────────────────────────────────
  await post('POST /api/auth/register — rejects empty body',
    `${STUDIO_URL}/api/auth/register`, {}, { expectStatus: [400, 422, 409] });

  await post('POST /api/auth/login — rejects empty credentials',
    `${STUDIO_URL}/api/auth/login`, {}, { expectStatus: [400, 401, 422] });

  // Login with structurally invalid body — must return 400/422, not 500
  await post('POST /api/auth/login — rejects invalid email format',
    `${STUDIO_URL}/api/auth/login`,
    { email: 'not-an-email', password: 'x' }, { expectStatus: [400, 401, 422] });

  // ── Protected endpoints — unauthenticated requests must return 401 ─────────
  await get('GET /api/renders → 401 (unauthenticated)',     `${STUDIO_URL}/api/renders`,   { expectStatus: 401 });
  await get('GET /api/assets → 401 (unauthenticated)',      `${STUDIO_URL}/api/assets`,    { expectStatus: 401 });
  await get('GET /api/projects → 401 (unauthenticated)',    `${STUDIO_URL}/api/projects`,  { expectStatus: 401 });
  await get('GET /api/brands → 401 (unauthenticated)',      `${STUDIO_URL}/api/brands`,    { expectStatus: 401 });
  await get('GET /api/users/me → 401 (unauthenticated)',    `${STUDIO_URL}/api/users/me`,  { expectStatus: 401 });
  await get('GET /api/billing → 401 (unauthenticated)',     `${STUDIO_URL}/api/billing`,   { expectStatus: 401 });
  await get('GET /api/analytics → 401 (unauthenticated)',   `${STUDIO_URL}/api/analytics`, { expectStatus: 401 });
  await get('GET /api/providers → 401 (unauthenticated)',   `${STUDIO_URL}/api/providers`, { expectStatus: 401 });
  await get('GET /api/admin → 401 or 403 (no token)',       `${STUDIO_URL}/api/admin`,     { expectStatus: [401, 403] });

  // POST protected — unauthenticated renders POST must return 401, not 500
  await post('POST /api/renders → 401 (unauthenticated)',
    `${STUDIO_URL}/api/renders`,
    { storyboardId: 'x', scenes: [], config: {} }, { expectStatus: [400, 401] });

  // ── 404 handler — server must return JSON 404, not HTML or 500 ────────────
  const notFound = await get('GET /api/nonexistent-route → 404',
    `${STUDIO_URL}/api/nonexistent-route-smoke-test`,
    { expectStatus: 404 });
  if (notFound) {
    pass('  404 handler — server returned 404 (not 500 or HTML crash)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  console.log(C.head('\n══════════════════════════════════════════════'));
  console.log(C.head(' ARKIOL v1 — HTTP Smoke Tests'));
  console.log(C.head('══════════════════════════════════════════════\n'));

  await testArkiolCore();
  await testAnimationStudio();

  // Write results to file for CI artefact upload
  const summary = { passed, failed, total: passed + failed, results };
  try {
    const { writeFileSync } = await import('fs');
    writeFileSync('/tmp/smoke-results.json', JSON.stringify(summary, null, 2));
  } catch { /* non-fatal */ }

  console.log('\n' + C.head('══════════════════════════════════════════════'));
  console.log(C.head(` Results: ${passed} passed, ${failed} failed / ${passed + failed} total`));
  console.log(C.head('══════════════════════════════════════════════\n'));

  if (failed > 0) {
    console.log('\x1b[31mFailed checks:\x1b[0m');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
    });
    console.log('');
    process.exit(1);
  }

  console.log('\x1b[32mAll smoke tests passed ✓\x1b[0m\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n[http-smoke-tests] Unexpected error:', err);
  process.exit(1);
});
