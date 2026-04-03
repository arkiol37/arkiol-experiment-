import crypto from 'crypto';
export function computeFingerprint(content: Buffer | string, metadata?: Record<string, unknown>): string { const h = crypto.createHash('sha256'); h.update(typeof content === 'string' ? content : content); if (metadata) h.update(JSON.stringify(metadata)); return h.digest('hex').slice(0, 24); }
export function fingerprintsMatch(a: string, b: string): boolean { return a === b; }
