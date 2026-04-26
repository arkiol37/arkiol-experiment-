// src/engines/ai/brief-cache.ts
// ─────────────────────────────────────────────────────────────────────────────
// In-memory brief analysis cache.
//
// Why this exists:
//   analyzeBrief() makes a 2-5s OpenAI gpt-4o call on every request,
//   even when the same prompt + format + brand combination has been
//   analyzed before. On Render's free instance this 2-5s burn shows
//   up as a flat tax on every generation, including back-to-back
//   tries from the same user iterating on the same prompt.
//
//   The brief is deterministic for a given (prompt, format, locale,
//   brand) tuple — the gpt-4o response itself is sampled, but at
//   temperature 0.7 the structured fields (intent, audience, tone,
//   colorMood, headline) collapse onto a small set of stable values
//   for any specific input. Memoising the first response is enough
//   to make the second click on the same prompt feel instant.
//
//   Cache lives in-process. On Render, a single container handles
//   sequential requests, so the cache is hot for the typical "user
//   tweaks the prompt and re-clicks generate" loop. Across container
//   restarts (cold start, deploy) the cache empties — that's
//   intentional: a stale brief is worse than a fresh one when the
//   underlying brief schema or model has changed.
//
// Contract:
//   • Pure cache layer over analyzeBrief — same signature, same
//     return type, deterministic key.
//   • Strict TTL so a misfire (e.g. partial GPT response forced
//     through schema recovery) ages out within an hour.
//   • LRU bound so a busy container can't grow the cache without
//     limit; oldest entries are evicted first.
//   • Hit/miss telemetry so ops can see the cache effectiveness
//     in the [free-tier] timing log.
// ─────────────────────────────────────────────────────────────────────────────
import * as crypto from "node:crypto";
import { analyzeBrief, type BriefAnalysis, type BriefAnalysisOptions } from "./brief-analyzer";

interface CacheEntry {
  brief:       BriefAnalysis;
  /** Wall-clock when the entry was inserted; used for TTL eviction. */
  insertedAt:  number;
  /** Last-read timestamp; used for LRU ordering. */
  lastReadAt:  number;
}

/** TTL after which a cached brief is considered stale and a fresh
 *  GPT call is forced. 1 hour balances "instant repeat clicks feel
 *  instant" against "pipeline schema bumps roll out within an
 *  hour". */
const TTL_MS = 60 * 60 * 1000;

/** Maximum cache size. A single Render starter instance handles
 *  ~10-50 unique prompts per hour during peak — 200 entries is
 *  enough to retain every one of them while keeping the cache's
 *  memory footprint negligible (~200 × 2KB = 400KB). */
const MAX_ENTRIES = 200;

const cache = new Map<string, CacheEntry>();

let _hits = 0;
let _misses = 0;
let _evictions = 0;

/** Hash the cache key. SHA-1 (truncated to 16 hex chars) is plenty
 *  unique for an in-process LRU and avoids collisions across the
 *  brand / prompt combinations we see in production. */
function buildCacheKey(opts: BriefAnalysisOptions): string {
  const brandPart = opts.brand
    ? `${opts.brand.primaryColor}|${opts.brand.secondaryColor}|${opts.brand.fontDisplay}`
    : "no-brand";
  const fields = [
    (opts.prompt ?? "").trim(),
    opts.stylePreset ?? "auto",
    opts.format ?? "any",
    opts.locale ?? "en",
    brandPart,
  ].join("‖");
  return crypto.createHash("sha1").update(fields).digest("hex").slice(0, 16);
}

/** Drop entries whose insertedAt is older than TTL_MS. Called on
 *  every read so stale rows can't accumulate when traffic drops. */
function evictExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of cache) {
    if (entry.insertedAt < cutoff) {
      cache.delete(key);
      _evictions++;
    }
  }
}

/** Drop the least-recently-read entry until size is within the cap.
 *  O(N) scan — acceptable at MAX_ENTRIES = 200. */
function evictLruIfFull(): void {
  while (cache.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestRead = Infinity;
    for (const [key, entry] of cache) {
      if (entry.lastReadAt < oldestRead) {
        oldestRead = entry.lastReadAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) break;
    cache.delete(oldestKey);
    _evictions++;
  }
}

export interface CachedBriefResult {
  brief:    BriefAnalysis;
  cached:   boolean;
  /** Wall-clock ms spent in the analyzer call (or 0 on cache hit). */
  briefMs:  number;
  /** Cache key for telemetry — never returned to the user. */
  cacheKey: string;
}

/** Cache wrapper around analyzeBrief. Returns the brief PLUS a
 *  flag indicating whether the result came from cache, so callers
 *  can surface the hit in their per-stage timing log.
 *
 *  Cache misses persist the freshly-computed brief before
 *  returning. Cache hits update lastReadAt to keep the entry
 *  warm at the head of the LRU. */
export async function analyzeBriefCached(
  opts: BriefAnalysisOptions,
): Promise<CachedBriefResult> {
  evictExpired();
  const cacheKey = buildCacheKey(opts);

  const hit = cache.get(cacheKey);
  if (hit) {
    hit.lastReadAt = Date.now();
    _hits++;
    return { brief: hit.brief, cached: true, briefMs: 0, cacheKey };
  }

  _misses++;
  const t0 = Date.now();
  const brief = await analyzeBrief(opts);
  const briefMs = Date.now() - t0;

  evictLruIfFull();
  cache.set(cacheKey, {
    brief,
    insertedAt: Date.now(),
    lastReadAt: Date.now(),
  });

  return { brief, cached: false, briefMs, cacheKey };
}

/** Cache stats for observability. The `[free-tier]` timing log
 *  appends these so ops can read hit-rate at a glance without a
 *  separate metrics endpoint. */
export function briefCacheStats(): { size: number; hits: number; misses: number; evictions: number } {
  return {
    size:      cache.size,
    hits:      _hits,
    misses:    _misses,
    evictions: _evictions,
  };
}

/** Test hook — clear the cache between runs. Not exported via
 *  index because production never calls it. */
export function _resetBriefCacheForTests(): void {
  cache.clear();
  _hits = 0;
  _misses = 0;
  _evictions = 0;
}
