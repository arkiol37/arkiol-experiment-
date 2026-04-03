import crypto from 'crypto';
export function generateSignedUrl(url: string, expiresInSec = 3600): string { const exp = Math.floor(Date.now() / 1000) + expiresInSec; const secret = process.env.CDN_SIGNING_SECRET || 'default-secret'; const sig = crypto.createHmac('sha256', secret).update(`${url}${exp}`).digest('hex').slice(0, 16); return `${url}?expires=${exp}&sig=${sig}`; }
export function addWatermark(isFreeUser: boolean): string | null { if (!isFreeUser) return null; return "drawtext=text='Made with Arkiol':fontsize=24:fontcolor=white@0.4:x=(w-tw)/2:y=h-th-20"; }
