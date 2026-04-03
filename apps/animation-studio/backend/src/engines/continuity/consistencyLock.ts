import type { ContinuityToken } from "../types";

interface LockedToken extends ContinuityToken { lockedAt: Date; lockedBy: string; immutable: boolean; }
class ConsistencyLockStore {
  private locks = new Map<string, LockedToken>();
  lock(t: ContinuityToken, by: string): LockedToken { const k = `${t.scope}:${t.category}:${t.key}`; const lt: LockedToken = { ...t, lockedAt: new Date(), lockedBy: by, immutable: t.category === "brand" }; this.locks.set(k, lt); return lt; }
  isLocked(t: ContinuityToken): boolean { return this.locks.has(`${t.scope}:${t.category}:${t.key}`); }
  getLockedValue(key: string, cat: string, scope: string): unknown | undefined { return this.locks.get(`${scope}:${cat}:${key}`)?.value; }
  unlock(t: ContinuityToken): boolean { const k = `${t.scope}:${t.category}:${t.key}`; if (this.locks.get(k)?.immutable) return false; return this.locks.delete(k); }
  getAllLocks(): LockedToken[] { return Array.from(this.locks.values()); }
  clear(): void { this.locks.clear(); }
}
const stores = new Map<string, ConsistencyLockStore>();
export function getConsistencyStore(id: string): ConsistencyLockStore { let s = stores.get(id); if (!s) { s = new ConsistencyLockStore(); stores.set(id, s); } return s; }
export function releaseConsistencyStore(id: string): void { stores.delete(id); }
export { ConsistencyLockStore };
