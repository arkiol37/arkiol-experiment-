/**
 * Storyboard Planner — builds complete scene-by-scene storyboard with prompts,
 * voiceover, visual direction, transitions, camera, and continuity tokens.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DirectorIntent, NarrativeArc, EmotionPoint, StoryboardScene, SceneRole, TransitionType, CameraPreset, ShotType } from '../types';
import { getArcSceneRoles } from './narrativeArcEngine';

const MOOD_PROMPTS: Record<string, string> = {
  Luxury: 'ultra-premium aesthetic, dark rich backgrounds, gold accents, elegant slow motion',
  Energetic: 'high energy kinetic motion, vibrant saturated colors, fast dynamic cuts',
  Minimal: 'clean white space, minimal design language, refined typography',
  Playful: 'bright cheerful colors, bouncy animations, fun typography',
  Cinematic: 'cinematic depth of field, dramatic lighting, film grain texture',
  Emotional: 'warm intimate lighting, authentic human moments, genuine emotion',
  Corporate: 'professional clean design, trustworthy blue tones, modern business aesthetic',
  Bold: 'high contrast, impactful full-screen typography, commanding visual power',
  Calm: 'serene soft lighting, gentle motion blur, peaceful elements',
  Tech: 'futuristic holographic UI, data streams, neon on dark, sci-fi interface',
};

const ROLE_DEFAULTS: Record<SceneRole, { shot: ShotType; cam: CameraPreset; tin: TransitionType; tout: TransitionType; vis: string; voice: (b: string) => string }> = {
  hook:         { shot: 'close_up',  cam: 'push_in',          tin: 'cut',       tout: 'crossfade', vis: 'Bold typography, high contrast, immediate brand recognition', voice: (b) => `Introducing ${b}.` },
  problem:      { shot: 'medium',    cam: 'horizontal_drift', tin: 'crossfade', tout: 'crossfade', vis: 'Desaturated tones, tension-building composition',              voice: () => 'The old way just doesn\'t work anymore.' },
  solution:     { shot: 'medium',    cam: 'pull_back',        tin: 'zoom',      tout: 'crossfade', vis: 'Color shift to brand palette, product hero shot',              voice: (b) => `${b} changes everything.` },
  proof:        { shot: 'medium',    cam: 'ken_burns',        tin: 'crossfade', tout: 'crossfade', vis: 'Trust signals, real results, customer imagery',                 voice: (b) => `Thousands already trust ${b}.` },
  cta:          { shot: 'close_up',  cam: 'push_in',          tin: 'crossfade', tout: 'cut',       vis: 'CTA button prominent, brand colors peak, logo lock-up',         voice: (b) => `Try ${b} free today.` },
  brand_reveal: { shot: 'wide',      cam: 'rise_up',          tin: 'zoom',      tout: 'crossfade', vis: 'Full brand colors, logo animation, aspirational',               voice: (b) => `${b} — built for results.` },
  offer:        { shot: 'close_up',  cam: 'static_lock',      tin: 'push',      tout: 'crossfade', vis: 'Offer details prominent, urgency elements',                     voice: (b) => `Limited time — exclusive access to ${b}.` },
  close:        { shot: 'wide',      cam: 'pull_back',        tin: 'crossfade', tout: 'dissolve',  vis: 'Logo lock-up, brand tagline, gentle fade',                      voice: (b) => `${b} — start today.` },
  end:          { shot: 'medium',    cam: 'static_lock',      tin: 'dissolve',  tout: 'cut',       vis: 'Clean end card, logo centered',                                 voice: (b) => `Visit ${b.toLowerCase().replace(/ /g, '')}.com` },
};

function allocateDurations(roles: SceneRole[], totalSec: number): number[] {
  const weights: Record<string, number> = { hook: 1.3, problem: 1.0, solution: 1.2, proof: 0.9, cta: 1.1, brand_reveal: 0.8, offer: 1.0, close: 0.7, end: 0.5 };
  const totalWeight = roles.reduce((s, r) => s + (weights[r] || 1), 0);
  const durations = roles.map(r => Math.max(3, Math.round((totalSec * (weights[r] || 1)) / totalWeight)));
  const diff = totalSec - durations.reduce((s, d) => s + d, 0);
  if (diff !== 0 && durations.length > 0) { const li = durations.indexOf(Math.max(...durations)); durations[li] = Math.max(3, durations[li] + diff); }
  return durations;
}

export function planStoryboard(intent: DirectorIntent, arc?: NarrativeArc, emotionCurve?: EmotionPoint[]): StoryboardScene[] {
  const roles = getArcSceneRoles(intent.sceneCount, intent);
  const durations = allocateDurations(roles, intent.maxDurationSec);
  const moodPrompt = MOOD_PROMPTS[intent.mood] || '';
  const tension = arc?.tensionCurve || roles.map(() => 0.5);
  const scenes: StoryboardScene[] = [];
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]; const d = ROLE_DEFAULTS[role]; const dur = durations[i];
    const emotion = emotionCurve?.[i]; const t = tension[i] ?? 0.5;
    const prompt = `Brand: ${intent.brand.name}. ${intent.brand.brief ? 'Brief: ' + intent.brand.brief + '.' : ''} ${d.vis}. Style: ${moodPrompt}. Platform: ${intent.platform}, ${intent.placement}. Aspect: ${intent.aspectRatio}. Duration: ${dur}s.${intent.renderMode === 'Cinematic Ad' ? ' Cinematic quality: depth of field, film grain, letterbox.' : ''}`;
    scenes.push({
      id: uuidv4(), position: i, role, durationSec: dur, prompt, voiceoverScript: d.voice(intent.brand.name),
      visualDirection: `${d.vis}. ${moodPrompt}`,
      onScreenText: role === 'hook' ? (intent.brand.brief?.split('.')[0] || intent.brand.name) : role === 'cta' ? `Try ${intent.brand.name} Free` : role === 'offer' ? 'Limited Time Offer' : role === 'brand_reveal' ? intent.brand.name : undefined,
      transitionIn: d.tin, transitionOut: d.tout,
      emotionTarget: emotion?.intensity ?? t,
      pacingBpm: Math.round((({ Luxury: 80, Energetic: 130, Minimal: 90, Playful: 120, Cinematic: 95, Emotional: 75, Corporate: 100, Bold: 120, Calm: 70, Tech: 110 } as any)[intent.mood] || 100) * (0.8 + t * 0.4)),
      cameraMove: d.cam, shotType: d.shot, depthLayers: [], audioSync: [],
      continuityTokens: [
        { key: 'brand_name', value: intent.brand.name, scope: 'global', category: 'brand' },
        { key: 'mood', value: intent.mood, scope: 'global', category: 'color' },
        { key: 'aspect_ratio', value: intent.aspectRatio, scope: 'global', category: 'layout' },
        ...(intent.brand.palette?.length ? [{ key: 'primary_color', value: intent.brand.palette[0], scope: 'global' as const, category: 'color' as const }] : []),
      ],
      qualityTarget: 0.7 + t * 0.2,
    });
  }
  return scenes;
}
