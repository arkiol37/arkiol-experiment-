/**
 * Animation Studio Engine Types
 * Canonical type definitions consumed by every engine subsystem.
 */

// ── Primitives ──────────────────────────────────────────────────────────

export type SceneRole = 'hook' | 'problem' | 'solution' | 'proof' | 'cta' | 'brand_reveal' | 'offer' | 'close' | 'end';
export type Mood = 'Luxury' | 'Energetic' | 'Minimal' | 'Playful' | 'Cinematic' | 'Emotional' | 'Corporate' | 'Bold' | 'Calm' | 'Tech';
export type HookType = 'pain_point' | 'curiosity_gap' | 'bold_claim' | 'social_proof' | 'direct_offer' | 'question' | 'shocking_stat';
export type AdObjective = 'awareness' | 'consideration' | 'conversion' | 'retention' | 'app_install';
export type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';
export type AspectRatio = '9:16' | '1:1' | '16:9';
export type RenderMode = 'Normal Ad' | 'Cinematic Ad';
export type TransitionType = 'cut' | 'crossfade' | 'push' | 'zoom' | 'wipe' | 'morph' | 'dissolve' | 'slide';
export type ShotType = 'wide' | 'medium' | 'close_up' | 'extreme_close' | 'aerial' | 'pov' | 'over_shoulder' | 'dutch_angle';
export type CameraPreset = 'push_in' | 'pull_back' | 'horizontal_drift' | 'ken_burns' | 'static_lock' | 'rise_up' | 'orbit' | 'crane_down' | 'dolly_left' | 'dolly_right';
export type DepthLayerName = 'background' | 'midground' | 'subject' | 'headline' | 'supporting' | 'overlay' | 'vignette';
export type EasingFunction = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring' | 'bounce' | 'elastic';

// ── Brand ───────────────────────────────────────────────────────────────

export interface BrandContext {
  name: string; brief: string; industry: string;
  valueProposition?: string; targetAudience?: string; uniqueSellingPoint?: string;
  palette?: string[]; logoUrl?: string; brandAssetIds?: string[];
}

export interface AudienceProfile {
  ageRange: [number, number]; gender: 'all' | 'male' | 'female';
  interests: string[]; psychographics: string[]; platform: Platform;
  attentionSpanMs: number; peakEngagementSec: number;
}

// ── Director ────────────────────────────────────────────────────────────

export interface DirectorIntent {
  objective: AdObjective; brand: BrandContext; audience: AudienceProfile;
  mood: Mood; hookType: HookType; platform: Platform; placement: string;
  maxDurationSec: number; sceneCount: number; renderMode: RenderMode; aspectRatio: AspectRatio;
}

export interface NarrativeArc {
  totalDurationSec: number; peakEmotionAt: number; tensionCurve: number[];
  resolutionAt: number; hookWindowMs: number;
}

export interface EmotionPoint {
  timeMs: number; intensity: number; valence: number; arousal: number; label: string;
}

// ── Storyboard ──────────────────────────────────────────────────────────

export interface StoryboardScene {
  id: string; position: number; role: SceneRole; durationSec: number;
  prompt: string; voiceoverScript: string; visualDirection: string;
  onScreenText?: string; transitionIn: TransitionType; transitionOut: TransitionType;
  emotionTarget: number; pacingBpm: number; cameraMove: CameraPreset;
  shotType: ShotType; depthLayers: DepthLayerSpec[]; audioSync: AudioSyncPoint[];
  continuityTokens: ContinuityToken[]; qualityTarget: number;
}

// ── Shot & Camera ───────────────────────────────────────────────────────

export interface ShotPlan {
  sceneId: string; shotType: ShotType; cameraMove: CameraPreset;
  focalPoint: { x: number; y: number }; depthOfField: number;
  motionIntensity: number; lightingMood: string;
}

export interface CameraKeyframe {
  timeMs: number; scale: number; translateX: number; translateY: number;
  rotation: number; easing: string;
}

// ── Depth & Spatial ─────────────────────────────────────────────────────

export interface DepthLayerSpec {
  layer: DepthLayerName; zIndex: number; parallaxFactor: number;
  blurRadius: number; scaleReserve: number; elements: LayerElement[];
}

export interface LayerElement {
  id: string; type: 'image' | 'text' | 'shape' | 'video' | 'gradient';
  position: { x: number; y: number; width: number; height: number };
  opacity: number; rotation: number; filters?: Record<string, number>;
}

// ── Timeline & Motion ───────────────────────────────────────────────────

export interface TimelineTrack {
  id: string; type: 'scene' | 'transition' | 'audio' | 'overlay' | 'subtitle';
  startMs: number; endMs: number; layerIndex: number; data: Record<string, unknown>;
}

export interface MotionKeyframe {
  timeMs: number; property: string; value: number; easing: EasingFunction;
}

export interface MotionPlan {
  elementId: string; keyframes: MotionKeyframe[]; semanticIntent: string; priority: number;
}

// ── Audio ───────────────────────────────────────────────────────────────

export interface AudioSyncPoint {
  timeMs: number; type: 'beat' | 'accent' | 'transition' | 'vocal_start' | 'vocal_end' | 'silence';
  intensity: number; linkedSceneEvent?: string;
}

export interface MusicProfile {
  bpm: number; key: string; energy: number; mood: string; segments: MusicSegment[];
}

export interface MusicSegment {
  startMs: number; endMs: number;
  type: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' | 'drop' | 'buildup'; energy: number;
}

export interface SoundEffect {
  id: string; category: string; triggerMs: number; durationMs: number; volume: number;
}

// ── Continuity ──────────────────────────────────────────────────────────

export interface ContinuityToken {
  key: string; value: unknown; scope: 'scene' | 'global';
  category: 'color' | 'font' | 'layout' | 'motion' | 'brand' | 'character';
}

export interface ContinuityViolation {
  sceneId: string; token: ContinuityToken; expected: unknown; actual: unknown;
  severity: 'warning' | 'error' | 'critical'; autoFixable: boolean; suggestedFix?: string;
}

// ── Quality ─────────────────────────────────────────────────────────────

export interface QualityScore {
  overall: number; visual: number; motion: number; audio: number; brand: number;
  readability: number; coherence: number; passed: boolean; issues: QualityIssue[];
}

export interface QualityIssue {
  id: string; severity: 'info' | 'warning' | 'error' | 'critical';
  category: string; message: string; sceneId?: string;
  autoFixable: boolean; fixSuggestion?: string;
}

// ── Render ──────────────────────────────────────────────────────────────

export interface RenderPass {
  id: string; name: string; order: number; inputLayers: string[];
  outputFormat: string; filters: string[]; quality: number;
}

// ── Pipeline ────────────────────────────────────────────────────────────

export interface PipelineStage {
  name: string; status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  startedAt?: Date; completedAt?: Date; durationMs?: number;
  retries: number; error?: string; output?: unknown;
}

export interface PipelineContext {
  renderJobId: string; workspaceId: string; userId: string;
  intent: DirectorIntent; storyboard: StoryboardScene[];
  timeline: TimelineTrack[]; qualityScores: QualityScore[];
  stages: PipelineStage[]; decisions: DecisionLogEntry[];
  startedAt: Date; metadata: Record<string, unknown>;
}

export interface DecisionLogEntry {
  timestamp: Date; engine: string; decision: string; confidence: number;
  alternatives: string[]; reasoning: string;
}

export interface ConfidenceScore {
  value: number; factors: Record<string, number>;
  recommendation: 'proceed' | 'review' | 'abort';
}
