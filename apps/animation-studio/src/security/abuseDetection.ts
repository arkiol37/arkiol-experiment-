import { logger } from '../config/logger';
const BLOCKED = [/ignore\s+previous\s+instructions/i, /system\s*prompt/i, /jailbreak/i, /<script/i];
export interface AbuseSignal { type: string; severity: 'low' | 'medium' | 'high'; details: string; }
export function detectAbuse(input: { prompt: string; workspaceId: string; requestsPerHour: number }): AbuseSignal[] {
  const signals: AbuseSignal[] = [];
  for (const p of BLOCKED) if (p.test(input.prompt)) signals.push({ type: 'prompt_injection', severity: 'high', details: `Blocked: ${p.source}` });
  if (input.requestsPerHour > 50) signals.push({ type: 'excessive_rate', severity: 'medium', details: `${input.requestsPerHour} req/hr` });
  if (signals.length > 0) logger.warn(`[AbuseDetection] ${signals.length} signals for ${input.workspaceId}`);
  return signals;
}
export function shouldBlock(signals: AbuseSignal[]): boolean { return signals.some(s => s.severity === 'high'); }
