import crypto from 'crypto';
interface Entry { key: string; renderJobId: string; outputUrl: string; thumbnailUrl: string; createdAt: Date; expiresAt: Date; }
const rc = new Map<string, Entry>();
export function computeRenderCacheKey(config: Record<string, unknown>): string { return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 32); }
export function getCachedRender(key: string): Entry | null { const e = rc.get(key); if (!e) return null; if (e.expiresAt < new Date()) { rc.delete(key); return null; } return e; }
export function cacheRender(key: string, jobId: string, outputUrl: string, thumbUrl: string, ttlMs = 86400000): void { rc.set(key, { key, renderJobId: jobId, outputUrl, thumbnailUrl: thumbUrl, createdAt: new Date(), expiresAt: new Date(Date.now() + ttlMs) }); }
