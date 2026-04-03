/**
 * Template Learning Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 * Converts high-performing ads into reusable templates that pre-populate the
 * orchestrator with proven configurations. Tracks which mood + hook +
 * pacing + shot grammar combinations produce the best results and surfaces
 * them as "Proven Templates" in the UI.
 */

import type { DirectorIntent, StoryboardScene, SceneRole, Mood, HookType, Platform, AdObjective } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AdTemplate {
  id: string;
  name: string;
  description: string;
  category: 'proven' | 'trending' | 'new' | 'custom';
  performance: TemplatePerformance;
  config: TemplateConfig;
  sourceRenderJobIds: string[];
  createdAt: Date;
  usageCount: number;
  lastUsedAt: Date | null;
}

export interface TemplatePerformance {
  avgQualityScore: number;        // 0-100
  avgUserRating: number;          // 1-5
  avgCtr: number;                 // click-through rate
  avgCompletionRate: number;      // video completion rate
  sampleSize: number;
  confidenceLevel: number;        // 0-1
}

export interface TemplateConfig {
  mood: Mood;
  hookType: HookType;
  objective: AdObjective;
  sceneCount: number;
  sceneRoles: SceneRole[];
  pacingProfile: 'slow' | 'moderate' | 'fast';
  emotionArc: number[];           // emotion intensity per scene
  cameraPresets: string[];
  transitionStyle: string;
  musicEnergy: number;
  voiceTone: string;
  platform: Platform;
  aspectRatio: string;
  renderMode: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILT-IN PROVEN TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

const BUILT_IN_TEMPLATES: AdTemplate[] = [
  {
    id: 'tmpl_hook_hard_sell', name: 'Hook & Hard Sell', description: 'High-converting direct response ad. Strong pain point hook, rapid solution reveal, urgency CTA.',
    category: 'proven', performance: { avgQualityScore: 82, avgUserRating: 4.2, avgCtr: 3.8, avgCompletionRate: 0.72, sampleSize: 150, confidenceLevel: 0.85 },
    config: { mood: 'Bold', hookType: 'pain_point', objective: 'conversion', sceneCount: 5, sceneRoles: ['hook', 'problem', 'solution', 'proof', 'cta'], pacingProfile: 'fast', emotionArc: [0.9, 0.7, 0.85, 0.6, 0.95], cameraPresets: ['push_in', 'horizontal_drift', 'pull_back', 'ken_burns', 'push_in'], transitionStyle: 'push', musicEnergy: 0.8, voiceTone: 'Confident', platform: 'instagram', aspectRatio: '9:16', renderMode: 'Normal Ad' },
    sourceRenderJobIds: [], createdAt: new Date('2026-01-15'), usageCount: 342, lastUsedAt: new Date(),
  },
  {
    id: 'tmpl_cinematic_brand', name: 'Cinematic Brand Story', description: 'Premium brand awareness ad. Emotional journey with cinematic production value.',
    category: 'proven', performance: { avgQualityScore: 91, avgUserRating: 4.7, avgCtr: 2.1, avgCompletionRate: 0.85, sampleSize: 89, confidenceLevel: 0.78 },
    config: { mood: 'Cinematic', hookType: 'curiosity_gap', objective: 'awareness', sceneCount: 6, sceneRoles: ['hook', 'problem', 'solution', 'proof', 'brand_reveal', 'cta'], pacingProfile: 'moderate', emotionArc: [0.7, 0.5, 0.8, 0.65, 0.9, 0.75], cameraPresets: ['crane_down', 'horizontal_drift', 'push_in', 'ken_burns', 'rise_up', 'static_lock'], transitionStyle: 'dissolve', musicEnergy: 0.6, voiceTone: 'Calm', platform: 'youtube', aspectRatio: '16:9', renderMode: 'Cinematic Ad' },
    sourceRenderJobIds: [], createdAt: new Date('2026-02-01'), usageCount: 156, lastUsedAt: new Date(),
  },
  {
    id: 'tmpl_tiktok_native', name: 'TikTok Native', description: 'Creator-style ad that feels organic. Fast hook, authentic energy, direct CTA.',
    category: 'proven', performance: { avgQualityScore: 78, avgUserRating: 4.0, avgCtr: 4.5, avgCompletionRate: 0.68, sampleSize: 230, confidenceLevel: 0.9 },
    config: { mood: 'Energetic', hookType: 'shocking_stat', objective: 'conversion', sceneCount: 4, sceneRoles: ['hook', 'solution', 'proof', 'cta'], pacingProfile: 'fast', emotionArc: [0.95, 0.8, 0.7, 0.9], cameraPresets: ['push_in', 'dolly_right', 'static_lock', 'push_in'], transitionStyle: 'cut', musicEnergy: 0.9, voiceTone: 'Energetic', platform: 'tiktok', aspectRatio: '9:16', renderMode: 'Normal Ad' },
    sourceRenderJobIds: [], createdAt: new Date('2026-02-15'), usageCount: 478, lastUsedAt: new Date(),
  },
  {
    id: 'tmpl_luxury_product', name: 'Luxury Product Showcase', description: 'Premium product-focused ad with elegant lighting and slow reveals.',
    category: 'proven', performance: { avgQualityScore: 88, avgUserRating: 4.5, avgCtr: 2.8, avgCompletionRate: 0.79, sampleSize: 67, confidenceLevel: 0.72 },
    config: { mood: 'Luxury', hookType: 'bold_claim', objective: 'consideration', sceneCount: 5, sceneRoles: ['hook', 'solution', 'proof', 'brand_reveal', 'cta'], pacingProfile: 'slow', emotionArc: [0.6, 0.8, 0.65, 0.85, 0.7], cameraPresets: ['crane_down', 'orbit', 'ken_burns', 'rise_up', 'static_lock'], transitionStyle: 'dissolve', musicEnergy: 0.4, voiceTone: 'Luxury', platform: 'instagram', aspectRatio: '9:16', renderMode: 'Cinematic Ad' },
    sourceRenderJobIds: [], createdAt: new Date('2026-03-01'), usageCount: 98, lastUsedAt: new Date(),
  },
  {
    id: 'tmpl_social_proof', name: 'Social Proof Blitz', description: 'Trust-building ad leveraging social proof and testimonials.',
    category: 'proven', performance: { avgQualityScore: 80, avgUserRating: 4.1, avgCtr: 3.2, avgCompletionRate: 0.74, sampleSize: 112, confidenceLevel: 0.82 },
    config: { mood: 'Emotional', hookType: 'social_proof', objective: 'consideration', sceneCount: 5, sceneRoles: ['hook', 'proof', 'solution', 'proof', 'cta'], pacingProfile: 'moderate', emotionArc: [0.7, 0.75, 0.85, 0.8, 0.9], cameraPresets: ['push_in', 'ken_burns', 'pull_back', 'horizontal_drift', 'push_in'], transitionStyle: 'crossfade', musicEnergy: 0.5, voiceTone: 'Confident', platform: 'facebook', aspectRatio: '16:9', renderMode: 'Normal Ad' },
    sourceRenderJobIds: [], createdAt: new Date('2026-03-10'), usageCount: 203, lastUsedAt: new Date(),
  },
];

// Custom templates learned from user renders
const customTemplates: AdTemplate[] = [];

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export function getProvenTemplates(platform?: Platform, objective?: AdObjective): AdTemplate[] {
  let templates = [...BUILT_IN_TEMPLATES, ...customTemplates.filter(t => t.category === 'proven')];
  if (platform) templates = templates.filter(t => t.config.platform === platform);
  if (objective) templates = templates.filter(t => t.config.objective === objective);
  return templates.sort((a, b) => b.performance.avgQualityScore - a.performance.avgQualityScore);
}

export function getTemplateById(id: string): AdTemplate | undefined {
  return [...BUILT_IN_TEMPLATES, ...customTemplates].find(t => t.id === id);
}

export function applyTemplate(templateId: string, overrides?: Partial<TemplateConfig>): TemplateConfig | null {
  const template = getTemplateById(templateId);
  if (!template) return null;
  template.usageCount++;
  template.lastUsedAt = new Date();
  return { ...template.config, ...overrides };
}

/**
 * Learn a new template from a completed render that received good feedback.
 */
export function learnTemplate(
  renderJobId: string,
  intent: DirectorIntent,
  storyboard: StoryboardScene[],
  qualityScore: number,
  userRating: number,
): AdTemplate | null {
  // Only learn from high-quality renders
  if (qualityScore < 75 || userRating < 4) return null;

  const template: AdTemplate = {
    id: `tmpl_learned_${uuidv4().slice(0, 8)}`,
    name: `${intent.mood} ${intent.objective} (learned)`,
    description: `Auto-generated template from high-performing ${intent.platform} ad`,
    category: 'custom',
    performance: {
      avgQualityScore: qualityScore, avgUserRating: userRating,
      avgCtr: 0, avgCompletionRate: 0, sampleSize: 1, confidenceLevel: 0.3,
    },
    config: {
      mood: intent.mood, hookType: intent.hookType, objective: intent.objective,
      sceneCount: storyboard.length,
      sceneRoles: storyboard.map(s => s.role),
      pacingProfile: storyboard[0]?.pacingBpm > 110 ? 'fast' : storyboard[0]?.pacingBpm > 85 ? 'moderate' : 'slow',
      emotionArc: storyboard.map(s => s.emotionTarget),
      cameraPresets: storyboard.map(s => s.cameraMove),
      transitionStyle: storyboard[0]?.transitionOut || 'crossfade',
      musicEnergy: 0.6,
      voiceTone: 'Confident',
      platform: intent.platform,
      aspectRatio: intent.aspectRatio,
      renderMode: intent.renderMode,
    },
    sourceRenderJobIds: [renderJobId],
    createdAt: new Date(),
    usageCount: 0,
    lastUsedAt: null,
  };

  customTemplates.push(template);
  return template;
}

/**
 * Update template performance metrics when a render using it completes.
 */
export function updateTemplatePerformance(
  templateId: string,
  qualityScore: number,
  userRating?: number,
  ctr?: number,
  completionRate?: number,
): void {
  const template = getTemplateById(templateId);
  if (!template) return;
  const p = template.performance;
  const n = p.sampleSize;
  p.avgQualityScore = (p.avgQualityScore * n + qualityScore) / (n + 1);
  if (userRating) p.avgUserRating = (p.avgUserRating * n + userRating) / (n + 1);
  if (ctr) p.avgCtr = (p.avgCtr * n + ctr) / (n + 1);
  if (completionRate) p.avgCompletionRate = (p.avgCompletionRate * n + completionRate) / (n + 1);
  p.sampleSize++;
  p.confidenceLevel = Math.min(0.95, 0.3 + p.sampleSize * 0.005);
  // Promote to 'proven' if enough data
  if (template.category === 'custom' && p.sampleSize >= 20 && p.avgQualityScore >= 75) {
    (template as any).category = 'proven';
  }
}
