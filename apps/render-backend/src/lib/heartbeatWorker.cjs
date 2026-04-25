// apps/render-backend/src/lib/heartbeatWorker.cjs
//
// Heartbeat that runs in a SEPARATE worker thread with its OWN
// event loop, so the main thread's heavy generation work
// (sharp/libvips bursts, large JSON, SVG assembly) cannot starve
// it. The previous in-process setInterval was queued on the same
// loop as runInlineGeneration — when the loop wedged for >10s the
// pulse couldn't fire and Vercel's polling watchdog flipped the
// row to FAILED.
//
// Why a worker thread (not a child process)? Worker threads share
// the parent's V8 isolate startup cost (faster boot, ~5-20ms vs
// ~150ms for a fork) but get their own libuv event loop and their
// own thread of execution. That's exactly what we need: cheap
// isolation that survives main-thread blocking.
//
// Why pg directly (not Prisma)? Prisma's client is heavy to
// bootstrap inside a worker thread (loads the engine, the Pg
// adapter, the schema-aware types) and we don't need any of that
// for a single-row UPDATE. Raw pg cuts worker startup by ~80%.
//
// Wire protocol (parent ↔ worker):
//   workerData: { jobId, intervalMs, databaseUrl }
//   parent → worker:
//     'stop'  — clean shutdown, disconnect, exit 0
//   worker → parent:
//     { type: 'ready' }                        — connected to DB
//     { type: 'connect_error', message }       — DB connect failed
//     { type: 'heartbeat', progress }          — successful pulse
//     { type: 'error', message }               — transient pulse error
//     { type: 'terminal', status }             — row reached COMPLETED/FAILED
//     { type: 'gone' }                         — row vanished (rare)
const { parentPort, workerData } = require('worker_threads');
const { Client } = require('pg');

const jobId       = String(workerData?.jobId ?? '');
const intervalMs  = Number(workerData?.intervalMs ?? 12_000);
const databaseUrl = String(workerData?.databaseUrl ?? process.env.DATABASE_URL ?? '');

if (!jobId)       fatal('missing_jobId');
if (!databaseUrl) fatal('missing_databaseUrl');

const client = new Client({ connectionString: databaseUrl });
let stopped = false;
let lastSeenProgress = 0;
let interval = null;

async function tick() {
  if (stopped) return;
  try {
    const r = await client.query(
      'SELECT status, progress FROM job WHERE id = $1',
      [jobId],
    );
    if (r.rows.length === 0) {
      stopped = true;
      send({ type: 'gone' });
      return;
    }
    const { status, progress } = r.rows[0];
    if (status === 'COMPLETED' || status === 'FAILED') {
      stopped = true;
      send({ type: 'terminal', status });
      return;
    }
    const next = Math.max(lastSeenProgress, Number(progress) || 0);
    lastSeenProgress = next;
    await client.query(
      'UPDATE job SET progress = $1, "updatedAt" = NOW() WHERE id = $2',
      [next, jobId],
    );
    send({ type: 'heartbeat', progress: next });
  } catch (err) {
    send({ type: 'error', message: errMessage(err) });
  }
}

(async () => {
  try {
    await client.connect();
    send({ type: 'ready' });
    interval = setInterval(() => { void tick(); }, intervalMs);
    void tick();
  } catch (err) {
    send({ type: 'connect_error', message: errMessage(err) });
  }
})();

parentPort?.on('message', async (msg) => {
  if (msg === 'stop') {
    stopped = true;
    if (interval) clearInterval(interval);
    try { await client.end(); } catch { /* ignore */ }
    process.exit(0);
  }
});

function send(msg) {
  try { parentPort?.postMessage(msg); } catch { /* ignore */ }
}

function errMessage(err) {
  return (err && (err.message || String(err))) || 'unknown';
}

function fatal(reason) {
  send({ type: 'connect_error', message: `worker_init_${reason}` });
  process.exit(1);
}
