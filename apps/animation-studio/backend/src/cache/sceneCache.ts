import crypto from 'crypto';
interface CacheEntry { key: string; videoUrl: string; provider: string; createdAt: Date; accessCount: number; lastAccessed: Date; }
const cache = new Map<string, CacheEntry>();
export function computeCacheKey(prompt: string, config: { aspectRatio: string; renderMode: string; mood: string }): string { return crypto.createHash('sha256').update(`${prompt}|${config.aspectRatio}|${config.renderMode}|${config.mood}`).digest('hex').slice(0, 32); }
export function getCachedScene(key: string): { videoUrl: string; provider: string } | null { const e = cache.get(key); if (!e) return null; e.accessCount++; e.lastAccessed = new Date(); return { videoUrl: e.videoUrl, provider: e.provider }; }
export function cacheScene(key: string, videoUrl: string, provider: string): void { if (cache.size >= 500) { let ok = ''; let t = Infinity; for (const [k, v] of cache) if (v.lastAccessed.getTime() < t) { t = v.lastAccessed.getTime(); ok = k; } if (ok) cache.delete(ok); } cache.set(key, { key, videoUrl, provider, createdAt: new Date(), accessCount: 1, lastAccessed: new Date() }); }
export function getCacheStats(): { size: number } { return { size: cache.size }; }
