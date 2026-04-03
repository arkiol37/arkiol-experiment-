export interface DepthEstimate { elementId: string; depth: number; confidence: number; method: 'rule_based'; }
export function estimateDepth(elements: { id: string; type: string; y: number; role?: string }[]): DepthEstimate[] {
  return elements.map(el => {
    let depth = 0.3 + (el.y / 100) * 0.5; let confidence = 0.6;
    if (el.type === 'gradient') { depth = 0; confidence = 0.9; }
    if (el.type === 'text') { depth = Math.max(0.6, depth); confidence = 0.8; }
    if (el.role === 'background') { depth = 0; confidence = 0.95; }
    if (el.role === 'logo') { depth = 0.8; confidence = 0.9; }
    return { elementId: el.id, depth: Math.max(0, Math.min(1, depth)), confidence, method: 'rule_based' as const };
  });
}
export function assignToLayers(estimates: DepthEstimate[]): Record<string, string[]> {
  const layers: Record<string, string[]> = { background: [], midground: [], subject: [], foreground: [], overlay: [] };
  for (const e of estimates) { if (e.depth < 0.15) layers.background.push(e.elementId); else if (e.depth < 0.35) layers.midground.push(e.elementId); else if (e.depth < 0.65) layers.subject.push(e.elementId); else if (e.depth < 0.85) layers.foreground.push(e.elementId); else layers.overlay.push(e.elementId); }
  return layers;
}
