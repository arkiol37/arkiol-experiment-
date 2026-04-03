import { logger } from '../config/logger';
interface KeyEntry { provider: string; keyId: string; active: boolean; createdAt: Date; expiresAt: Date; }
const store = new Map<string, KeyEntry[]>();
export function registerKey(provider: string, keyId: string, ttlDays = 90): void { const e = store.get(provider) || []; e.push({ provider, keyId, active: true, createdAt: new Date(), expiresAt: new Date(Date.now() + ttlDays * 86400000) }); store.set(provider, e); }
export function getActiveKey(provider: string): string | null { const e = store.get(provider) || []; const a = e.find(k => k.active && k.expiresAt > new Date()); return a?.keyId || null; }
export function rotateKey(provider: string, newKeyId: string): void { const e = store.get(provider) || []; e.forEach(k => k.active = false); e.push({ provider, keyId: newKeyId, active: true, createdAt: new Date(), expiresAt: new Date(Date.now() + 90 * 86400000) }); store.set(provider, e); logger.info(`[KeyRotation] Rotated key for ${provider}`); }
