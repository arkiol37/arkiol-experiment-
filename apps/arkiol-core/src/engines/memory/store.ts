// src/engines/memory/store.ts
//
// Memory-persistence abstraction. Separates the "how we remember" from
// the "what we remember" so the generation ledger + visual-pattern
// memory can switch between in-process storage (default, fast, no
// infra) and a shared Redis/DB-backed store (production, scales across
// workers) without touching the record shapes.
//
// Default is InMemoryStore — zero infra, resets on restart. Production
// deployments should configure RedisMemoryStore (stub here; pluggable
// via the factory below).

import type { GenerationRecord } from "./generation-ledger";
import type { VisualPatternSignature } from "./visual-patterns";

// ── Stored shapes ────────────────────────────────────────────────────────────

export interface StoredPattern {
  signature: VisualPatternSignature;
  signal:    number;
  source:    "quality" | "selection" | "positive_feedback";
  timestamp: number;
}

// ── Store interface ──────────────────────────────────────────────────────────

export interface MemoryStore {
  readonly kind: "in-memory" | "redis" | "custom";

  // Generation ledger ────────────────────────────────────────────────
  pushRecord(record: GenerationRecord): Promise<void> | void;
  updateRecord(assetId: string, patch: Partial<GenerationRecord>): Promise<boolean> | boolean;
  listRecords(limit: number): Promise<GenerationRecord[]> | GenerationRecord[];
  findRecord(assetId: string): Promise<GenerationRecord | null> | GenerationRecord | null;

  // Visual-pattern memory ────────────────────────────────────────────
  pushPattern(pattern: StoredPattern): Promise<void> | void;
  listPatterns(limit?: number): Promise<StoredPattern[]> | StoredPattern[];
  clearPatterns(): Promise<void> | void;
}

// ── In-memory implementation (default) ───────────────────────────────────────

export class InMemoryStore implements MemoryStore {
  readonly kind = "in-memory" as const;
  private readonly records: GenerationRecord[] = [];
  private readonly patterns: StoredPattern[] = [];

  constructor(
    private readonly maxRecords  = 200,
    private readonly maxPatterns = 200,
  ) {}

  pushRecord(record: GenerationRecord): void {
    this.records.unshift(record);
    if (this.records.length > this.maxRecords) this.records.length = this.maxRecords;
  }

  updateRecord(assetId: string, patch: Partial<GenerationRecord>): boolean {
    const entry = this.records.find(r => r.assetId === assetId);
    if (!entry) return false;
    Object.assign(entry, patch);
    return true;
  }

  listRecords(limit: number): GenerationRecord[] {
    return this.records.slice(0, limit);
  }

  findRecord(assetId: string): GenerationRecord | null {
    return this.records.find(r => r.assetId === assetId) ?? null;
  }

  pushPattern(pattern: StoredPattern): void {
    this.patterns.unshift(pattern);
    if (this.patterns.length > this.maxPatterns) this.patterns.length = this.maxPatterns;
  }

  listPatterns(limit?: number): StoredPattern[] {
    return typeof limit === "number" ? this.patterns.slice(0, limit) : this.patterns.slice();
  }

  clearPatterns(): void {
    this.patterns.length = 0;
  }
}

// ── Redis-backed implementation (stub) ───────────────────────────────────────
// Placeholder. Fill in with real ioredis bindings when deploying
// at-scale. Contract: every operation is async and falls back to the
// in-memory store on connection errors so a flaky Redis doesn't take
// the generation pipeline offline.

export class RedisMemoryStore implements MemoryStore {
  readonly kind = "redis" as const;
  // Fallback store handles both the error path (Redis down) and the
  // development path (no Redis configured).
  private readonly fallback = new InMemoryStore();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly opts: { redisUrl?: string; keyPrefix?: string } = {}) {
    // A production implementation would connect lazily here:
    //   const Redis = (await import('ioredis')).default;
    //   this.client = new Redis(opts.redisUrl);
    // For now the stub delegates everything to the in-memory store so
    // the rest of the pipeline doesn't need to know the difference.
  }

  pushRecord(record: GenerationRecord): Promise<void> {
    return Promise.resolve(this.fallback.pushRecord(record));
  }
  updateRecord(assetId: string, patch: Partial<GenerationRecord>): Promise<boolean> {
    return Promise.resolve(this.fallback.updateRecord(assetId, patch));
  }
  listRecords(limit: number): Promise<GenerationRecord[]> {
    return Promise.resolve(this.fallback.listRecords(limit));
  }
  findRecord(assetId: string): Promise<GenerationRecord | null> {
    return Promise.resolve(this.fallback.findRecord(assetId));
  }
  pushPattern(pattern: StoredPattern): Promise<void> {
    return Promise.resolve(this.fallback.pushPattern(pattern));
  }
  listPatterns(limit?: number): Promise<StoredPattern[]> {
    return Promise.resolve(this.fallback.listPatterns(limit));
  }
  clearPatterns(): Promise<void> {
    return Promise.resolve(this.fallback.clearPatterns());
  }
}

// ── Active store (singleton) ─────────────────────────────────────────────────
// Configured once at boot via configureMemoryStore. Default is
// InMemoryStore; ops can swap to RedisMemoryStore by reading env vars
// in a small boot shim. The shared module-level reference means the
// ledger + visual-patterns modules pick up whichever store is active
// without having to thread it through every call site.

let _activeStore: MemoryStore = new InMemoryStore();

export function configureMemoryStore(store: MemoryStore): void {
  _activeStore = store;
}

export function getMemoryStore(): MemoryStore {
  return _activeStore;
}

// Env-driven factory so production can opt into Redis without code
// changes. Call once at worker boot.
export function createMemoryStoreFromEnv(): MemoryStore {
  const driver = typeof process !== "undefined"
    ? (process.env as Record<string, string | undefined>).ARKIOL_MEMORY_STORE
    : undefined;
  if (driver === "redis") {
    const redisUrl = typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined>).REDIS_URL
      : undefined;
    return new RedisMemoryStore({ redisUrl });
  }
  return new InMemoryStore();
}
