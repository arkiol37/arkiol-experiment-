export interface SegmentedObject { id: string; label: string; bounds: { x: number; y: number; width: number; height: number }; confidence: number; layerSuggestion: string; }
export function segmentObjects(sceneRole: string, hasText: boolean, hasBrandAssets: boolean): SegmentedObject[] {
  const objects: SegmentedObject[] = [];
  objects.push({ id: 'bg', label: 'background', bounds: { x: 0, y: 0, width: 100, height: 100 }, confidence: 1, layerSuggestion: 'background' });
  if (['hook','solution','proof'].includes(sceneRole)) objects.push({ id: 'subject', label: 'primary_subject', bounds: { x: 15, y: 10, width: 70, height: 75 }, confidence: 0.85, layerSuggestion: 'subject' });
  if (hasText) objects.push({ id: 'text', label: 'headline_text', bounds: { x: 10, y: 30, width: 80, height: 20 }, confidence: 0.9, layerSuggestion: 'headline' });
  if (hasBrandAssets) objects.push({ id: 'logo', label: 'brand_logo', bounds: { x: 35, y: 85, width: 30, height: 10 }, confidence: 0.95, layerSuggestion: 'overlay' });
  return objects;
}
