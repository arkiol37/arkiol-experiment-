// scripts/load-test.ts
//
// Arkiol Load Testing Suite
// Usage:
//   npx ts-node scripts/load-test.ts --target=http://localhost:3000 --users=20 --duration=60
//
// Tests:
//   - /api/generate:    generation throughput under concurrent load
//   - /api/assets:      read-path latency under load
//   - /api/export:      export latency per format
//   - /api/health:      baseline latency and availability
//
// Outputs:
//   - Per-endpoint p50/p95/p99/p100 latency
//   - RPS (requests per second)
//   - Error rate
//   - Credit reservation contention rate
//   - Rate-limit hit rate

import https from "https";
import http  from "http";
import { URL } from "url";

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => a.replace("--", "").split("="))
);

const TARGET   = args.target   ?? "http://localhost:3000";
const USERS    = parseInt(args.users    ?? "10");
const DURATION = parseInt(args.duration ?? "30"); // seconds
const API_KEY  = args.apiKey   ?? process.env.LOAD_TEST_API_KEY ?? "";
const ORG_ID   = args.orgId    ?? process.env.LOAD_TEST_ORG_ID  ?? "";

if (!API_KEY) {
  console.error("[load-test] ERROR: --apiKey or LOAD_TEST_API_KEY required");
  process.exit(1);
}

// ── Request helper ────────────────────────────────────────────────────────────
interface RequestResult {
  status:     number;
  latencyMs:  number;
  error?:     string;
}

async function request(
  path:    string,
  method:  "GET" | "POST" = "GET",
  body?:   unknown
): Promise<RequestResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const url     = new URL(path, TARGET);
    const isHttps = url.protocol === "https:";
    const lib     = isHttps ? https : http;

    const bodyStr = body ? JSON.stringify(body) : undefined;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${API_KEY}`,
        "X-Api-Key":     API_KEY,
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr).toString() } : {}),
      },
    }, (res) => {
      res.resume(); // drain
      resolve({ status: res.statusCode ?? 0, latencyMs: Date.now() - start });
    });

    req.on("error", (err) => {
      resolve({ status: 0, latencyMs: Date.now() - start, error: err.message });
    });

    req.setTimeout(15_000, () => {
      req.destroy(new Error("timeout"));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Metrics collector ─────────────────────────────────────────────────────────
interface Metrics {
  total:       number;
  errors:      number;
  status429:   number;
  status402:   number;
  latencies:   number[];
  startTime:   number;
}

function createMetrics(): Metrics {
  return { total: 0, errors: 0, status429: 0, status402: 0, latencies: [], startTime: Date.now() };
}

function record(metrics: Metrics, result: RequestResult) {
  metrics.total++;
  metrics.latencies.push(result.latencyMs);
  if (result.error || result.status === 0 || result.status >= 500) metrics.errors++;
  if (result.status === 429) metrics.status429++;
  if (result.status === 402) metrics.status402++;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function report(name: string, metrics: Metrics) {
  const elapsed  = (Date.now() - metrics.startTime) / 1000;
  const rps      = metrics.total / elapsed;
  const errorPct = (metrics.errors   / metrics.total * 100).toFixed(1);
  const rlPct    = (metrics.status429 / metrics.total * 100).toFixed(1);
  const creditPct= (metrics.status402 / metrics.total * 100).toFixed(1);
  const sorted   = metrics.latencies.sort((a, b) => a - b);

  console.log(`\n──────────────────────────────────────`);
  console.log(`  ${name}`);
  console.log(`──────────────────────────────────────`);
  console.log(`  Requests:  ${metrics.total}  (${rps.toFixed(1)} rps)`);
  console.log(`  Errors:    ${metrics.errors} (${errorPct}%)`);
  console.log(`  RateLimit: ${metrics.status429} (${rlPct}%)`);
  console.log(`  NoCredits: ${metrics.status402} (${creditPct}%)`);
  console.log(`  Latency:`);
  console.log(`    p50:  ${percentile(sorted, 50)}ms`);
  console.log(`    p95:  ${percentile(sorted, 95)}ms`);
  console.log(`    p99:  ${percentile(sorted, 99)}ms`);
  console.log(`    p100: ${percentile(sorted, 100)}ms`);
}

// ── Test scenarios ─────────────────────────────────────────────────────────────
async function runScenario(
  name:    string,
  fn:      () => Promise<RequestResult>,
  opts:    { users: number; duration: number }
): Promise<Metrics> {
  const metrics = createMetrics();
  const end     = Date.now() + opts.duration * 1000;

  // Spawn virtual users
  const workers = Array.from({ length: opts.users }, async () => {
    while (Date.now() < end) {
      const result = await fn();
      record(metrics, result);
      // Small jitter to avoid thundering herd
      await new Promise(r => setTimeout(r, Math.random() * 100));
    }
  });

  await Promise.all(workers);
  return metrics;
}

// ── Scenarios ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nArkiol Load Test`);
  console.log(`  Target:   ${TARGET}`);
  console.log(`  Users:    ${USERS}`);
  console.log(`  Duration: ${DURATION}s per scenario`);
  console.log(`  Started:  ${new Date().toISOString()}\n`);

  // 1. Health check baseline
  console.log("[1/4] Health check baseline...");
  const healthMetrics = await runScenario(
    "GET /api/health",
    () => request("/api/health"),
    { users: USERS, duration: Math.min(DURATION, 10) }
  );
  report("GET /api/health", healthMetrics);

  // 2. Asset reads (read-heavy)
  console.log("\n[2/4] Asset read throughput...");
  const assetMetrics = await runScenario(
    "GET /api/assets",
    () => request("/api/assets?limit=20"),
    { users: USERS, duration: DURATION }
  );
  report("GET /api/assets", assetMetrics);

  // 3. Export latency per format
  console.log("\n[3/4] Export requests...");
  const formats = ["instagram_post", "youtube_thumbnail", "flyer"];
  const exportMetrics = await runScenario(
    "POST /api/export",
    () => request("/api/export", "POST", {
      assetIds:    ["test-asset-id"],
      format:      formats[Math.floor(Math.random() * formats.length)],
      quality:     "standard",
      fileFormat:  "png",
    }),
    { users: Math.min(USERS, 5), duration: DURATION }
  );
  report("POST /api/export", exportMetrics);

  // 4. Generate requests (write-heavy + credit reservation contention)
  console.log("\n[4/4] Generate requests (credit contention test)...");
  const generateMetrics = await runScenario(
    "POST /api/generate",
    () => request("/api/generate", "POST", {
      prompt:      "Summer sale campaign for premium sportswear brand",
      formats:     ["instagram_post"],
      stylePreset: "bold_lifestyle",
      variations:  1,
      includeGif:  false,
    }),
    { users: Math.min(USERS, 5), duration: DURATION }
  );
  report("POST /api/generate", generateMetrics);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const allMetrics = [healthMetrics, assetMetrics, exportMetrics, generateMetrics];
  const totalRequests = allMetrics.reduce((s, m) => s + m.total, 0);
  const totalErrors   = allMetrics.reduce((s, m) => s + m.errors, 0);
  const overallErrorPct = (totalErrors / totalRequests * 100).toFixed(2);

  console.log(`\n══════════════════════════════════════`);
  console.log(`  OVERALL SUMMARY`);
  console.log(`══════════════════════════════════════`);
  console.log(`  Total requests: ${totalRequests}`);
  console.log(`  Total errors:   ${totalErrors} (${overallErrorPct}%)`);
  console.log(`  Pass threshold: ${parseFloat(overallErrorPct) < 5 ? "✅ PASS" : "❌ FAIL"} (< 5% error rate)`);

  process.exit(parseFloat(overallErrorPct) < 5 ? 0 : 1);
}

main().catch((err) => {
  console.error("[load-test] Fatal error:", err);
  process.exit(1);
});
