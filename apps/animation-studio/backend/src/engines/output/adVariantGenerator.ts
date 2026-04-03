import { v4 as uuidv4 } from 'uuid';
import type { StoryboardScene, DirectorIntent, HookType } from '../types';
export interface AdVariant { id: string; name: string; description: string; changes: { type: string; sceneId: string; from: string; to: string }[]; scenes: StoryboardScene[]; }
const HA: Record<HookType, HookType[]> = { pain_point: ['curiosity_gap','bold_claim'], curiosity_gap: ['pain_point','question'], bold_claim: ['social_proof','shocking_stat'], social_proof: ['bold_claim','direct_offer'], direct_offer: ['pain_point','bold_claim'], question: ['curiosity_gap','pain_point'], shocking_stat: ['bold_claim','curiosity_gap'] };
const CA: Record<string, string[]> = { awareness: ['Learn More','Discover Now'], conversion: ['Buy Now','Get Started'], app_install: ['Download Free','Install Now'], consideration: ['Try Free','Start Today'], retention: ['Come Back'] };
export function generateVariants(scenes: StoryboardScene[], intent: DirectorIntent, max = 3): AdVariant[] {
  const variants: AdVariant[] = [];
  const hook = scenes.find(s => s.role === 'hook'); const alts = HA[intent.hookType] || [];
  if (hook && alts.length > 0) { const alt = alts[0]; variants.push({ id: uuidv4(), name: `Hook: ${alt}`, description: `Alternative ${alt} hook`, changes: [{ type: 'hook_swap', sceneId: hook.id, from: intent.hookType, to: alt }], scenes: scenes.map(s => ({ ...s, id: uuidv4() })) }); }
  const cta = scenes.find(s => s.role === 'cta'); const ctaAlts = CA[intent.objective] || CA.awareness;
  if (cta && ctaAlts.length > 0) { const alt = ctaAlts.find(c => c !== cta.onScreenText) || ctaAlts[0]; variants.push({ id: uuidv4(), name: `CTA: ${alt}`, description: 'Alt CTA', changes: [{ type: 'cta_swap', sceneId: cta.id, from: cta.onScreenText || '', to: alt }], scenes: scenes.map(s => s.id === cta.id ? { ...s, id: uuidv4(), onScreenText: alt, voiceoverScript: alt } : { ...s, id: uuidv4() }) }); }
  return variants.slice(0, max);
}
