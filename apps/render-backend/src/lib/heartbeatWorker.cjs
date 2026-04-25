// apps/render-backend/src/lib/heartbeatWorker.cjs
//
// Heartbeat that runs in a SEPARATE worker thread with its OWN
// event loop, so the main thread's heavy generation work
// (sharp/libvips bursts, large JSON, SVG assembly) cannot starve
// it.
//
// Why a worker thread (not a child process)? Worker threads share
// the parent's V8 isolate startup cost (faster boot, ~5-20ms vs
// ~150ms for a fork) but get their own libuv event loop and their
// own thread of execution.
//
// Why pg directly (not Prisma)? Prisma's client is heavy to
// bootstrap inside a worker thread, and we don't need any of its
// schema-aware machinery for a single-row UPDATE. Raw `pg` cuts
// worker startup by ~80%. pg's default extended-protocol query
// path uses UNNAMED prepared statements, so it's already
// PgBouncer-safe — no `?pgbouncer=true` flag required for the
// worker (though the main-thread Prisma client still wants it
// applied via apps/arkiol-core/src/lib/prisma.ts).
//
// Production-stability rules this worker follows:
//
//   - NEVER exit on a transient DB error. The whole point of the
//     worker is to keep heartbeating no matter what; if pg
//     refuses one query we just log and let the next 12s tick
//     try again.
//   - NEVER exit on connect failure. We retry with exponential
//     backoff (capped at 30s) until the parent says 'stop'. If
//     PgBouncer is briefly down, we'll resume the moment it
//     comes back.
//   - The only path that exits the worker is parent-driven:
//     an explicit 'stop' message. The parent always sends one
//     after the inner pipeline finishes (success OR failure).
//
// Wire protocol (parent ↔ worker):
//   workerData: { jobId, intervalMs, databaseUrl }
//   parent → worker:
//     'stop'  — clean shutdown, disconnect, exit 0
//   worker → parent:
//     { type: 'ready' }                        — connected to DB
//     { type: 'connect_error', message, retryInMs } — DB connect failed; will retry
//     { type: 'heartbeat', progress }          — successful pulse
//     { type: 'error', message }               — transient pulse error (worker still running)
//     { type: 'terminal', status }             — row reached COMPLETED/FAILED
//     { type: 'gone' }                         — row vanished (rare)
const { parentPort, workerData } = require('worker_threads');
const { Client } = require('pg');

const jobId       = String(workerData?.jobId ?? '');
const intervalMs  = Number(workerData?.intervalMs ?? 12_000);
const databaseUrl = String(workerData?.databaseUrl ?? process.env.DATABASE_URL ?? '');

if (!jobId)       fatal('missing_jobId');
if (!databaseUrl) fatal('missing_databaseUrl');

let client            = null;
let stopped           = false;
let lastSeenProgress  = 0;
let interval          = null;
let connectAttempt    = 0;
const CONNECT_BACKOFF_MIN_MS = 2_000;
const CONNECT_BACKOFF_MAX_MS = 30_000;

async function tick() {
  if (stopped) return;

  // Lazy connect / reconnect on demand. If a previous tick lost the
  // connection (pg.Client emits 'error' and goes unusable), we drop
  // the reference and try again here. Bounded backoff so a long
  // outage doesn't spam pg.
  if (!client) {
    connectAttempt += 1;
    const backoff = Math.min(
      CONNECT_BACKOFF_MAX_MS,
      CONNECT_BACKOFF_MIN_MS * Math.pow(2, Math.min(connectAttempt - 1, 5)),
    );
    try {
      const c = new Client({ connectionString: databaseUrl });
      // Suppress crashing on async pg errors — log and reset client
      // so the next tick reconnects.
      c.on('error', (err) => {
        send({ type: 'error', message: `pg client error: ${errMessage(err)}` });
        try { c.end(); } catch { /* ignore */ }
        if (client === c) client = null;
      });
      await c.connect();
      client = c;
      connectAttempt = 0;
      send({ type: 'ready' });
    } catch (err) {
      send({ type: 'connect_error', message: errMessage(err), retryInMs: backoff });
      // We don't sleep here — the next setInterval tick fires
      // automatically. But for the first failure we wait the
      // backoff before allowing another attempt to avoid a tight
      // loop when intervalMs is very small.
      if (backoff > intervalMs) {
        // Pause the interval briefly when backoff exceeds tick rate.
        if (interval) clearInterval(interval);
        setTimeout(() => {
          if (!stopped && !interval) {
            interval = setInterval(() => { void tick(); }, intervalMs);
          }
        }, backoff);
      }
      return;
    }
  }

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
    // Transient error: the next tick will try again. If the
    // connection was lost we drop our reference so tick() will
    // reconnect.
    send({ type: 'error', message: errMessage(err) });
    const code = err && err.code;
    if (
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === '57P01' || // admin_shutdown
      /Connection terminated/i.test(errMessage(err))
    ) {
      try { await client.end(); } catch { /* ignore */ }
      client = null;
    }
  }
}

(() => {
  // Don't await connect on boot — let the first tick handle it
  // through the same retry path so the worker never exits before
  // the parent has a chance to subscribe to messages.
  interval = setInterval(() => { void tick(); }, intervalMs);
  // Fire immediately so the parent sees activity in <100ms.
  void tick();
})();

parentPort?.on('message', async (msg) => {
  if (msg === 'stop') {
    stopped = true;
    if (interval) { clearInterval(interval); interval = null; }
    if (client) {
      try { await client.end(); } catch { /* ignore */ }
      client = null;
    }
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
