/**
 * Asset Registry — shared registry for brand assets across both apps.
 * Provides asset lookup, validation status tracking, and usage counting.
 */
export interface RegisteredAsset {
  id: string;
  workspaceId: string;
  type: string;
  name: string;
  url: string;
  format: string;
  width: number;
  height: number;
  hasTransparency: boolean;
  qualityScore: number;
  usageCount: number;
  lastUsedAt: Date | null;
  registeredAt: Date;
}

const registry = new Map<string, RegisteredAsset>();

export function registerAsset(asset: Omit<RegisteredAsset, 'usageCount' | 'lastUsedAt' | 'registeredAt'>): RegisteredAsset {
  const entry: RegisteredAsset = { ...asset, usageCount: 0, lastUsedAt: null, registeredAt: new Date() };
  registry.set(asset.id, entry);
  return entry;
}

export function getAsset(id: string): RegisteredAsset | undefined { return registry.get(id); }

export function getWorkspaceAssets(workspaceId: string, type?: string): RegisteredAsset[] {
  return Array.from(registry.values()).filter(a => a.workspaceId === workspaceId && (!type || a.type === type));
}

export function recordAssetUsage(id: string): void {
  const asset = registry.get(id);
  if (asset) { asset.usageCount++; asset.lastUsedAt = new Date(); }
}

export function getTopAssets(workspaceId: string, limit = 5): RegisteredAsset[] {
  return getWorkspaceAssets(workspaceId).sort((a, b) => b.usageCount - a.usageCount).slice(0, limit);
}
