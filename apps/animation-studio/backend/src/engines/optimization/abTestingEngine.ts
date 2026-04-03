import { v4 as uuidv4 } from 'uuid';
export interface ABTest { id: string; name: string; status: 'draft' | 'running' | 'concluded'; variants: ABVariant[]; createdAt: Date; winner?: string; }
export interface ABVariant { id: string; name: string; impressions: number; clicks: number; conversions: number; completionRate: number; }
export function createABTest(name: string, variantNames: string[]): ABTest {
  return { id: uuidv4(), name, status: 'draft', variants: variantNames.map(n => ({ id: uuidv4(), name: n, impressions: 0, clicks: 0, conversions: 0, completionRate: 0 })), createdAt: new Date() };
}
export function evaluateTest(test: ABTest): { winner: string | null; confidence: number; canConclude: boolean } {
  const vs = test.variants.filter(v => v.impressions > 0);
  if (vs.length < 2) return { winner: null, confidence: 0, canConclude: false };
  const minSample = 100;
  if (!vs.every(v => v.impressions >= minSample)) return { winner: null, confidence: 0, canConclude: false };
  const rates = vs.map(v => ({ id: v.id, rate: v.conversions / v.impressions })).sort((a, b) => b.rate - a.rate);
  const lift = rates[0].rate - rates[1].rate;
  const confidence = Math.min(0.99, lift * 10 * Math.sqrt(Math.min(...vs.map(v => v.impressions)) / 100));
  return { winner: confidence > 0.8 ? rates[0].id : null, confidence, canConclude: confidence > 0.8 };
}
